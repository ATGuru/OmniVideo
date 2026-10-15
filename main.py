import asyncio
import base64
import json
import os
import re
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

load_dotenv()

app = FastAPI(title="OmniVideo")

BASE_DIR = Path(__file__).parent
PROJECTS_DIR = BASE_DIR / "projects"
PROJECTS_DIR.mkdir(exist_ok=True)
KEY_FILE = Path.home() / "Documents" / "API" / "grok-video-pipeline.txt"

PROJECT_RE = re.compile(r"^[a-f0-9]{8}$")
SECTION_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
STILL_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}\.(jpg|jpeg|png|webp)$")
MAX_SONG = 80 * 1024 * 1024
MAX_STILL = 20 * 1024 * 1024
IMAGE_MODEL = "grok-imagine-image"
TEXT_MODEL = "grok-4.20-0309-non-reasoning"
IMAGE_COST = 0.02

_inflight = set()

app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


def api_key() -> str:
    key = os.getenv("XAI_API_KEY", "").strip()
    if key:
        return key
    if KEY_FILE.is_file():
        return KEY_FILE.read_text(encoding="utf-8").strip()
    return ""


def project_folder(project_id: str) -> Path:
    if not PROJECT_RE.fullmatch(project_id or ""):
        raise HTTPException(404, "Project not found")
    folder = (PROJECTS_DIR / project_id).resolve()
    try:
        folder.relative_to(PROJECTS_DIR.resolve())
    except ValueError:
        raise HTTPException(404, "Project not found")
    if not folder.is_dir():
        raise HTTPException(404, "Project not found")
    return folder


def read_timeline(folder: Path) -> dict:
    return json.loads((folder / "timeline.json").read_text(encoding="utf-8"))


def write_timeline(folder: Path, timeline: dict) -> None:
    (folder / "timeline.json").write_text(json.dumps(timeline, indent=2), encoding="utf-8")


def song_file(folder: Path, timeline: dict) -> Path:
    raw = timeline.get("song_path") or ""
    path = Path(raw)
    if not path.is_file():
        raise HTTPException(404, "Song file is missing.")
    try:
        path.resolve().relative_to(folder.resolve())
    except ValueError:
        raise HTTPException(400, "Song path is outside the project.")
    return path


def safe_song_name(filename: str) -> str:
    name = Path(filename or "song").name
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", name).strip(" .")
    if not name or name in {".", ".."}:
        name = "song"
    return name[:120]


def compose_prompt(timeline: dict, section: dict) -> str:
    parts = []
    feel = str(timeline.get("feel") or timeline.get("global_style") or "").strip()
    master = str(timeline.get("master_prompt") or "").strip()
    if feel:
        parts.append(feel)
    if master:
        parts.append(master)
    characters = []
    for person in (timeline.get("characters") or [])[:8]:
        if not isinstance(person, dict):
            continue
        name = str(person.get("name") or "").strip()
        look = str(person.get("look") or "").strip()
        bit = ", ".join(piece for piece in (name, look) if piece)
        if bit:
            characters.append(bit[:240])
    if characters:
        parts.append("Characters: " + "; ".join(characters))
    shot = str(section.get("prompt") or "").strip()
    lyrics = str(section.get("lyrics") or "").strip()
    if shot:
        parts.append(shot)
    elif lyrics:
        parts.append(lyrics)
    parts.append("Cinematic 16:9 still, no readable text, no logos")
    return ". ".join(parts)[:2000]


def clean_characters(value) -> list:
    people = []
    if not isinstance(value, list):
        return people
    for person in value[:8]:
        if not isinstance(person, dict):
            continue
        people.append({
            "name": str(person.get("name") or "")[:80],
            "look": str(person.get("look") or "")[:400],
        })
    return people


def error_text(response: httpx.Response, fallback: str = "Image request failed.") -> str:
    try:
        payload = response.json()
    except Exception:
        return fallback
    err = payload.get("error") if isinstance(payload, dict) else None
    message = ""
    if isinstance(err, dict):
        message = str(err.get("message") or "")
    elif isinstance(err, str):
        message = err
    message = message.strip()[:300]
    if not message or "xai-" in message.lower():
        return fallback
    return message


def response_text(payload: dict) -> str:
    direct = payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    chunks = []
    for item in payload.get("output") or []:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "message":
            for part in item.get("content") or []:
                if isinstance(part, dict) and part.get("type") in {"output_text", "text"}:
                    chunks.append(str(part.get("text") or ""))
        elif item.get("type") == "output_text":
            chunks.append(str(item.get("text") or ""))
    return "\n".join(chunks).strip()


async def imagine(prompt: str) -> bytes:
    key = api_key()
    if not key:
        raise HTTPException(400, "No API key is available on this machine.")
    headers = {"Authorization": f"Bearer {key}"}
    async with httpx.AsyncClient(timeout=180) as client:
        response = await client.post(
            "https://api.x.ai/v1/images/generations",
            headers=headers,
            json={
                "model": IMAGE_MODEL,
                "prompt": prompt,
                "aspect_ratio": "16:9",
                "resolution": "1k",
                "n": 1,
            },
        )
        if response.status_code >= 400:
            raise HTTPException(response.status_code, error_text(response))
        try:
            item = response.json()["data"][0]
        except Exception:
            raise HTTPException(502, "Imagine returned no image.")
        if item.get("b64_json"):
            return base64.b64decode(item["b64_json"])
        url = item.get("url") or ""
        if not url.startswith("https://"):
            raise HTTPException(502, "Imagine returned no image.")
        download = await client.get(url)
    if download.status_code >= 400 or not download.content:
        raise HTTPException(502, "Could not download the image.")
    return download.content


def image_ext(raw: bytes) -> str:
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if len(raw) >= 12 and raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        return "webp"
    return ""


def store_still(folder: Path, section_id: str, raw: bytes) -> str:
    ext = "png" if raw.startswith(b"\x89PNG") else "jpg"
    stills = folder / "stills"
    stills.mkdir(exist_ok=True)
    for old in stills.glob(section_id + ".*"):
        if STILL_RE.fullmatch(old.name):
            old.unlink()
    dest = stills / f"{section_id}.{ext}"
    dest.write_bytes(raw)
    return f"/api/project/{folder.name}/stills/{dest.name}"


@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse(BASE_DIR / "templates" / "index.html")


@app.get("/api/settings")
async def get_settings():
    return {"has_key": bool(api_key())}


@app.post("/api/settings")
async def save_settings(api_key: str = Form("")):
    key = api_key.strip()
    if not key:
        raise HTTPException(400, "No API key entered.")
    env_path = BASE_DIR / ".env"
    env_path.write_text("XAI_API_KEY=" + key + "\n", encoding="utf-8")
    os.chmod(env_path, 0o600)
    os.environ["XAI_API_KEY"] = key
    return {"ok": True}


@app.post("/api/project")
async def create_project(file: UploadFile = File(...)):
    content = await file.read()
    if len(content) > MAX_SONG:
        raise HTTPException(413, "Song is over 80 MB.")
    if len(content) < 1000:
        raise HTTPException(400, "That file looks empty.")
    import uuid

    project_id = uuid.uuid4().hex[:8]
    folder = PROJECTS_DIR / project_id
    folder.mkdir()
    song_name = safe_song_name(file.filename or "song.mp3")
    song_path = folder / song_name
    song_path.write_bytes(content)
    timeline = {
        "id": project_id,
        "song": song_name,
        "song_path": str(song_path),
        "global_style": "",
        "feel": "",
        "master_prompt": "",
        "characters": [],
        "sections": [],
    }
    write_timeline(folder, timeline)
    return {"project_id": project_id, "song": song_name}


@app.get("/api/project/{project_id}")
async def get_project(project_id: str):
    return read_timeline(project_folder(project_id))


@app.post("/api/project/{project_id}/timeline")
async def save_timeline(project_id: str, timeline: dict = Body(...)):
    folder = project_folder(project_id)
    current = read_timeline(folder)
    timeline["id"] = project_id
    timeline["song"] = current.get("song")
    timeline["song_path"] = current.get("song_path")
    if not isinstance(timeline.get("sections"), list):
        timeline["sections"] = []
    timeline["characters"] = clean_characters(timeline.get("characters"))
    write_timeline(folder, timeline)
    return {"ok": True}


@app.post("/api/project/{project_id}/transcribe")
async def transcribe(project_id: str):
    folder = project_folder(project_id)
    timeline = read_timeline(folder)
    song = song_file(folder, timeline)
    proc = await asyncio.create_subprocess_exec(
        "whisper",
        str(song),
        "--model",
        "base",
        "--device",
        "cpu",
        "--fp16",
        "False",
        "--output_format",
        "json",
        "--output_dir",
        str(folder),
        "--verbose",
        "False",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=1200)
    except asyncio.TimeoutError:
        proc.kill()
        raise HTTPException(504, "Transcription took too long.")
    if proc.returncode != 0:
        tail = (stderr or stdout or b"").decode("utf-8", "replace").strip().splitlines()
        detail = tail[-1][:300] if tail else "Whisper failed."
        raise HTTPException(500, detail)
    transcript_path = folder / f"{song.stem}.json"
    if not transcript_path.is_file():
        raise HTTPException(500, "Whisper did not write a transcript.")
    payload = json.loads(transcript_path.read_text(encoding="utf-8"))
    lines = []
    for segment in payload.get("segments") or []:
        text = str(segment.get("text") or "").strip()
        if not text:
            continue
        lines.append({
            "start": round(float(segment.get("start") or 0), 2),
            "end": round(float(segment.get("end") or 0), 2),
            "text": text,
        })
    clean = {"text": str(payload.get("text") or "").strip(), "lines": lines}
    (folder / "transcript.json").write_text(json.dumps(clean, indent=2), encoding="utf-8")
    return {"lines": lines, "text": clean["text"]}


@app.post("/api/suggest-prompt")
async def suggest_prompt(body: dict = Body(...)):
    lyrics = str(body.get("lyrics") or "").strip()
    if len(lyrics) < 2:
        raise HTTPException(400, "Drop some lyrics first.")
    key = api_key()
    if not key:
        raise HTTPException(400, "No API key is available on this machine.")
    feel = str(body.get("feel") or "").strip()[:1000]
    master = str(body.get("master_prompt") or "").strip()[:2000]
    characters = []
    for person in clean_characters(body.get("characters")):
        bit = ", ".join(piece for piece in (person["name"], person["look"]) if piece)
        if bit:
            characters.append(bit)
    user = "\n".join([
        "Feel: " + (feel or "unspecified"),
        "Master direction: " + (master or "none"),
        "Characters: " + ("; ".join(characters) or "none"),
        "Lyrics: " + lyrics[:1500],
    ])
    system = (
        "You write one image prompt for a music-video still. "
        "Describe what the camera sees in this lyric span, in one or two sentences. "
        "Fit the feel and characters when they are given. "
        "Do not quote the lyrics. Do not add a title, labels, or quotation marks. "
        "No readable text in the scene. Keep figures distant."
    )
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            "https://api.x.ai/v1/responses",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": TEXT_MODEL,
                "store": False,
                "max_output_tokens": 180,
                "input": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            },
        )
    if response.status_code >= 400:
        raise HTTPException(response.status_code, error_text(response, "Could not suggest a prompt."))
    text = response_text(response.json())
    if text.lower().startswith("prompt:"):
        text = text.split(":", 1)[1].strip()
    text = text.strip().strip('"').strip()
    if not text:
        raise HTTPException(502, "No prompt came back.")
    return {"prompt": text[:600]}


@app.post("/api/project/{project_id}/sections/{section_id}/image")
async def generate_image(project_id: str, section_id: str, body: dict = Body(...)):
    if not SECTION_RE.fullmatch(section_id):
        raise HTTPException(400, "Bad section id.")
    token = project_id + ":" + section_id
    if token in _inflight:
        raise HTTPException(409, "That image is already generating.")
    _inflight.add(token)
    try:
        folder = project_folder(project_id)
        timeline = read_timeline(folder)
        if "feel" in body:
            timeline["feel"] = str(body.get("feel") or "")[:1000]
            timeline["global_style"] = timeline["feel"]
        if "master_prompt" in body:
            timeline["master_prompt"] = str(body.get("master_prompt") or "")[:2000]
        if "characters" in body:
            timeline["characters"] = clean_characters(body.get("characters"))
        sections = timeline.setdefault("sections", [])
        section = next((item for item in sections if item.get("id") == section_id), None)
        if section is None:
            section = {"id": section_id}
            sections.append(section)
        if "prompt" in body:
            section["prompt"] = str(body.get("prompt") or "")[:2000]
        if body.get("lyrics"):
            section["lyrics"] = str(body.get("lyrics") or "")[:2000]
        if "start" in body:
            section["start"] = float(body.get("start") or 0)
        if "end" in body:
            section["end"] = float(body.get("end") or 0)
        prompt = compose_prompt(timeline, section)
        if len(prompt.strip()) < 8:
            raise HTTPException(400, "Write a prompt or drop lyrics onto this shot first.")
        raw = await imagine(prompt)
        if len(raw) < 500:
            raise HTTPException(502, "Imagine returned an empty image.")
        section["image"] = store_still(folder, section_id, raw)
        section["sent"] = prompt
        write_timeline(folder, timeline)
        print(f"still {project_id} {section_id} {len(raw)} bytes", flush=True)
        return {
            "id": section_id,
            "url": section["image"],
            "prompt": prompt,
            "cost": IMAGE_COST,
        }
    finally:
        _inflight.discard(token)


@app.post("/api/project/{project_id}/stills")
async def upload_stills(project_id: str, files: list[UploadFile] = File(...)):
    folder = project_folder(project_id)
    if not files:
        raise HTTPException(400, "Choose an image.")
    if len(files) > 24:
        raise HTTPException(400, "Upload up to 24 stills at a time.")
    prepared = []
    for upload in files:
        raw = await upload.read()
        if len(raw) > MAX_STILL:
            raise HTTPException(413, "Each still must be 20 MB or smaller.")
        ext = image_ext(raw)
        if not ext:
            raise HTTPException(400, "Use a JPEG, PNG, or WebP.")
        prepared.append((raw, ext, Path(upload.filename or "still").name[:80]))
    import uuid

    stills = folder / "stills"
    stills.mkdir(exist_ok=True)
    saved = []
    for raw, ext, original in prepared:
        name = "u" + uuid.uuid4().hex[:8]
        dest = stills / f"{name}.{ext}"
        dest.write_bytes(raw)
        saved.append({
            "id": name,
            "url": f"/api/project/{folder.name}/stills/{dest.name}",
            "name": original,
        })
    print(f"upload {project_id} {len(saved)} stills", flush=True)
    return {"stills": saved}


@app.delete("/api/project/{project_id}/stills/{filename}")
async def delete_still(project_id: str, filename: str):
    if not filename.startswith("u") or not STILL_RE.fullmatch(filename):
        raise HTTPException(404, "Image not found")
    folder = project_folder(project_id)
    timeline = read_timeline(folder)
    needle = "/stills/" + filename
    for section in timeline.get("sections") or []:
        if needle in str(section.get("image") or ""):
            raise HTTPException(400, "That still is on a shot.")
    path = folder / "stills" / filename
    if path.is_file():
        path.unlink()
    return {"ok": True}


@app.get("/api/project/{project_id}/stills/{filename}")
async def still(project_id: str, filename: str):
    if not STILL_RE.fullmatch(filename or ""):
        raise HTTPException(404, "Image not found")
    path = project_folder(project_id) / "stills" / filename
    if not path.is_file():
        raise HTTPException(404, "Image not found")
    return FileResponse(path)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8080)
