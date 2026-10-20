import asyncio
import base64
import hashlib
import json
import math
import os
import re
import time
import uuid
from pathlib import Path
from urllib.parse import quote

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
def projects_dir() -> Path:
    # Flutter client: set OMNIVIDEO_PROJECTS to the OmniBrain cloud folder
    # the phone already browses, usually /mnt/OBC/OmniVideo/Projects
    # (WebDAV path OmniVideo/Projects). Unset, the web board keeps
    # ~/OmniVideo/Projects.
    raw = os.getenv("OMNIVIDEO_PROJECTS", "").strip()
    return Path(raw).expanduser() if raw else Path.home() / "OmniVideo" / "Projects"


# Named projects live here so stills stay in a folder the user can find again.
HOME_PROJECTS = projects_dir()
HOME_PROJECTS.mkdir(parents=True, exist_ok=True)
KEY_FILE = Path.home() / "Documents" / "API" / "grok-video-pipeline.txt"

PROJECT_RE = re.compile(r"^[a-f0-9]{8}$")
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.'-]{0,59}$")
SECTION_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
CARD_ROLES = {"cover", "credit", "fill"}
STILL_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}\.(jpg|jpeg|png|webp)$")
MAX_SONG = 80 * 1024 * 1024
MAX_STILL = 20 * 1024 * 1024
IMAGE_MODEL = "grok-imagine-image"
TEXT_MODEL = "grok-4.20-0309-non-reasoning"
IMAGE_COST = 0.02
# Editing from a reference image adds an input charge per source image.
IMAGE_INPUT_COST = 0.002
IMAGE_EDIT_MODEL = os.getenv("IMAGE_EDIT_MODEL", "").strip() or IMAGE_MODEL
# grok-imagine-video-1.5-lite at 720p is $0.03 per generated second, plus
# $0.01 for the starting image of each request (docs.x.ai pricing page).
# One request is 1–15 seconds. 720p. The song is muxed locally afterwards.
VIDEO_MODEL = "grok-imagine-video-1.5-lite"
VIDEO_RATE = 0.03
# Each clip request also pays for its starting image.
VIDEO_IMAGE_COST = 0.01
VIDEO_RESOLUTION = "720p"
VIDEO_MAX = 15
VIDEO_FPS = 24
MAX_CLIPS = 80

# ACE-Step 1.5 runs on TEC's GPU (RTX 5050), in its own process. This laptop
# only calls the HTTP API. Do not start the model here: a CPU load OOMs this
# machine. On TEC: python -m acestep.api_server, with ACESTEP_API_HOST set so
# the-empty-chair:8001 is reachable. One GPU tenant at a time; leave it down
# while ComfyUI or another model holds the card. Gradio on port 7860 is not
# this client. Override with AUDIO_GEN_URL. Optional ACESTEP_API_KEY is Bearer
# auth for that server, not the xAI key.
AUDIO_GEN_URL = os.getenv("AUDIO_GEN_URL", "http://the-empty-chair:8001").rstrip("/")
GENERATED_DIR = BASE_DIR / "generated"
GENERATED_DIR.mkdir(exist_ok=True)
GEN_RE = re.compile(r"^g[a-f0-9]{8}\.(mp3|wav)$")
GEN_LENGTHS = {15, 30, 45, 60, 120, 180, 300}

_inflight = set()
_audio_job = False
_video_job = None
_video_task = None

app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


def api_key() -> str:
    key = os.getenv("XAI_API_KEY", "").strip()
    if key:
        return key
    if KEY_FILE.is_file():
        return KEY_FILE.read_text(encoding="utf-8").strip()
    return ""


def clean_project_name(raw: str) -> str:
    name = re.sub(r"\s+", " ", str(raw or "").strip()).strip(" .")
    # Eight hex characters are the old project ids. A folder with that name
    # would hide the song still stored under projects/<id>.
    if not name or not NAME_RE.fullmatch(name) or name in {".", ".."} or PROJECT_RE.fullmatch(name):
        raise HTTPException(400, "Use letters, numbers, spaces, or hyphens.")
    return name


def project_folder(project_id: str) -> Path:
    # A named folder wins when it exists, so a name is never confused with an old id.
    if project_id and NAME_RE.fullmatch(project_id):
        named = (HOME_PROJECTS / project_id).resolve()
        try:
            named.relative_to(HOME_PROJECTS.resolve())
        except ValueError:
            raise HTTPException(404, "Project not found")
        if named.is_dir():
            return named
    if PROJECT_RE.fullmatch(project_id or ""):
        folder = (PROJECTS_DIR / project_id).resolve()
        try:
            folder.relative_to(PROJECTS_DIR.resolve())
        except ValueError:
            raise HTTPException(404, "Project not found")
        if folder.is_dir():
            return folder
    raise HTTPException(404, "Project not found")


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


def compose_prompt(timeline: dict, section: dict, with_master: bool = True) -> str:
    # with_master=False when the still is an edit of a reference image: the
    # reference already shows the place, and repeating it in words competes
    # with the picture and buries the shot's own instructions.
    parts = []
    feel = str(timeline.get("feel") or timeline.get("global_style") or "").strip()
    master = str(timeline.get("master_prompt") or "").strip() if with_master else ""
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
    return ". ".join(part.rstrip(" .") for part in parts)[:2000]


def motion_prompt(timeline: dict, section: dict) -> str:
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
    # A shot's own motion prompt (set in the clip popup) wins over the still's
    # prompt. Left blank, the clip follows the still, as before.
    motion = str(section.get("motion") or "").strip()
    shot = str(section.get("prompt") or "").strip()
    lyrics = str(section.get("lyrics") or "").strip()
    if motion:
        parts.append(motion)
    elif shot:
        parts.append(shot)
    elif lyrics:
        parts.append(lyrics)
    parts.append("Natural cinematic motion. No readable text, no logos")
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


async def imagine(prompt: str, reference: Path | None = None) -> bytes:
    """One still. With a reference, the still is drawn as an edit of that
    image, so the place and people in it stay the same from shot to shot."""
    key = api_key()
    if not key:
        raise HTTPException(400, "No API key is available on this machine.")
    headers = {"Authorization": f"Bearer {key}"}
    if reference is not None:
        endpoint = "https://api.x.ai/v1/images/edits"
        body = {
            "model": IMAGE_EDIT_MODEL,
            "prompt": prompt,
            "image": {
                "type": "image_url",
                "url": "data:" + image_mime(reference) + ";base64,"
                + base64.b64encode(reference.read_bytes()).decode("ascii"),
            },
        }
    else:
        endpoint = "https://api.x.ai/v1/images/generations"
        body = {
            "model": IMAGE_MODEL,
            "prompt": prompt,
            "aspect_ratio": "16:9",
            "resolution": "1k",
            "n": 1,
        }
    async with httpx.AsyncClient(timeout=180) as client:
        response = await client.post(endpoint, headers=headers, json=body)
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


REF_RE = re.compile(r"^r[a-f0-9]{6}$")
REF_LEAD = (
    "Use the reference image as the ground truth for this shot: keep the setting, "
    "camera position, layout, furniture, objects, colors, and any person's face, build, "
    "and clothing exactly as they appear in it. Change only what this shot describes. "
    "Any mirror in it reflects only what is actually in front of it. "
)


def reference_list(timeline: dict) -> list:
    items = []
    for item in timeline.get("references") or []:
        if not isinstance(item, dict) or not REF_RE.fullmatch(str(item.get("id") or "")):
            continue
        items.append({
            "id": item["id"],
            "name": str(item.get("name") or "Reference")[:60],
            "image": str(item.get("image") or ""),
        })
    return items


def reference_state(timeline: dict) -> dict:
    items = reference_list(timeline)
    default = str(timeline.get("reference_default") or "")
    if items and default not in {item["id"] for item in items}:
        default = items[0]["id"]
    if not items:
        default = ""
    return {"references": items, "default": default}


def reference_for(folder: Path, timeline: dict, section: dict):
    """The reference this shot follows: its own pick, else the project
    default. "none" turns references off for that one shot."""
    choice = str(section.get("reference") or "")
    if choice == "none":
        return None
    state = reference_state(timeline)
    wanted = choice or state["default"]
    for item in state["references"]:
        if item["id"] == wanted:
            try:
                return still_file(folder, item["image"])
            except HTTPException:
                return None
    return None


def store_still(folder: Path, section_id: str, raw: bytes) -> str:
    ext = image_ext(raw) or "jpg"
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
    return FileResponse(
        BASE_DIR / "templates" / "index.html",
        headers={"Cache-Control": "no-cache"},
    )


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


@app.get("/api/projects")
async def list_projects():
    # Flutter client only. The web board does not call this.
    # Names and a cloud-relative folder, never secrets or file contents.
    root = HOME_PROJECTS.resolve()
    cloud_root = None
    try:
        cloud_root = root.relative_to(Path("/mnt/OBC").resolve()).as_posix()
    except ValueError:
        cloud_root = None
    items = []
    try:
        children = sorted(root.iterdir(), key=lambda path: path.name.lower())
    except OSError:
        children = []
    for folder in children:
        if not folder.is_dir() or not (folder / "timeline.json").is_file():
            continue
        if not NAME_RE.fullmatch(folder.name) or PROJECT_RE.fullmatch(folder.name):
            continue
        items.append({"id": folder.name, "name": folder.name})
    return {"projects": items, "cloud_root": cloud_root}


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


@app.post("/api/project/new")
async def create_named_project(body: dict = Body(...)):
    name = clean_project_name((body or {}).get("name"))
    folder = HOME_PROJECTS / name
    if folder.exists():
        raise HTTPException(409, "A project with that name already exists.")
    folder.mkdir()
    (folder / "stills").mkdir()
    timeline = {
        "id": name,
        "name": name,
        "song": "",
        "song_path": "",
        "global_style": "",
        "feel": "",
        "master_prompt": "",
        "characters": [],
        "sections": [],
    }
    write_timeline(folder, timeline)
    print(f"project {name}", flush=True)
    return {"project_id": name, "name": name}


@app.post("/api/project/{project_id}/song")
async def attach_song(project_id: str, file: UploadFile = File(...)):
    folder = project_folder(project_id)
    content = await file.read()
    if len(content) > MAX_SONG:
        raise HTTPException(413, "Song is over 80 MB.")
    if len(content) < 1000:
        raise HTTPException(400, "That file looks empty.")
    timeline = read_timeline(folder)
    song_name = safe_song_name(file.filename or "song.mp3")
    song_path = folder / song_name
    song_path.write_bytes(content)
    timeline["song"] = song_name
    timeline["song_path"] = str(song_path)
    write_timeline(folder, timeline)
    return {"project_id": project_id, "song": song_name}


async def probed_song_seconds(folder: Path, timeline: dict) -> float:
    """ffprobe length for the open board. Never written into timeline.json."""
    raw = str(timeline.get("song_path") or "")
    if not raw:
        return 0.0
    path = Path(raw)
    if not path.is_file():
        return 0.0
    try:
        path.resolve().relative_to(folder.resolve())
    except ValueError:
        return 0.0
    try:
        return round(float(await media_duration(path)), 1)
    except HTTPException:
        return 0.0


@app.get("/api/project/{project_id}")
async def get_project(project_id: str):
    folder = project_folder(project_id)
    timeline = dict(read_timeline(folder))
    timeline["duration"] = await probed_song_seconds(folder, timeline)
    return timeline


@app.post("/api/project/{project_id}/timeline")
async def save_timeline(project_id: str, timeline: dict = Body(...)):
    folder = project_folder(project_id)
    current = read_timeline(folder)
    timeline["id"] = project_id
    timeline["song"] = current.get("song")
    timeline["song_path"] = current.get("song_path")
    timeline.pop("duration", None)
    # References change only through their own endpoints.
    timeline["references"] = current.get("references") or []
    timeline["reference_default"] = current.get("reference_default") or ""
    if not isinstance(timeline.get("sections"), list):
        timeline["sections"] = []
    previous_roles = {}
    for item in current.get("sections") or []:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        if role in CARD_ROLES and item.get("id"):
            previous_roles[str(item.get("id"))] = role
    for item in timeline["sections"]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        if role in CARD_ROLES:
            item["role"] = role
            continue
        item.pop("role", None)
        kept = previous_roles.get(str(item.get("id") or ""))
        if kept:
            item["role"] = kept
    timeline["characters"] = clean_characters(timeline.get("characters"))
    if (folder / "video.mp4").is_file():
        timeline["video"] = f"/api/project/{project_id}/video"
    write_timeline(folder, timeline)
    return {"ok": True}


# Whisper output and corrected lyrics are kept per song, keyed by the song's
# bytes, so the same song is never transcribed twice and fixes carry over to
# any project that uses it.
CACHE_DIR = BASE_DIR / "cache"
CACHE_DIR.mkdir(exist_ok=True)
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base").strip() or "base"
_LRC_STAMP = re.compile(r"\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]")
_TAG_LINE = re.compile(r"^\s*\[[^\]\d][^\]]{0,47}\]\s*$")
_TOKEN = re.compile(r"[a-z0-9]+")


def song_key(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()[:24]


def norm_tokens(text: str) -> list:
    return _TOKEN.findall(str(text or "").lower().replace("'", "").replace("’", ""))


def parse_lrc(text: str) -> list:
    """Lines from an .lrc file. Empty when the text has no timestamps."""
    stamped = []
    for raw in str(text or "").splitlines():
        stamps = list(_LRC_STAMP.finditer(raw))
        if not stamps:
            continue
        words = _LRC_STAMP.sub("", raw).strip()
        if not words:
            continue
        for stamp in stamps:
            seconds = int(stamp.group(1)) * 60 + float(stamp.group(2).replace(":", "."))
            stamped.append((seconds, words))
    stamped.sort(key=lambda item: item[0])
    lines = []
    for index, (start, words) in enumerate(stamped):
        nxt = stamped[index + 1][0] if index + 1 < len(stamped) else start + 4.0
        end = max(start + 0.3, min(nxt, start + 8.0))
        lines.append({"start": round(start, 2), "end": round(end, 2), "text": words, "sure": True})
    return lines


def lyric_rows(text: str) -> list:
    """Sung lines from pasted lyrics. Section tags like [Chorus] are dropped."""
    rows = []
    for raw in str(text or "").splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        if not line or _TAG_LINE.fullmatch(line):
            continue
        rows.append(line[:300])
    return rows


def heard_words(payload: dict) -> list:
    words = []
    for segment in payload.get("segments") or []:
        items = segment.get("words") or []
        if items:
            for item in items:
                for token in norm_tokens(item.get("word")):
                    words.append((token, float(item.get("start") or 0), float(item.get("end") or 0)))
            continue
        # No word times: spread the segment evenly over its words.
        tokens = norm_tokens(segment.get("text"))
        if not tokens:
            continue
        start = float(segment.get("start") or 0)
        end = max(start + 0.1, float(segment.get("end") or start))
        step = (end - start) / len(tokens)
        for index, token in enumerate(tokens):
            words.append((token, start + index * step, start + (index + 1) * step))
    return words


def align_lyrics(rows: list, words: list, song_seconds: float) -> list:
    """Your words, the song's timing.

    Each lyric word that Whisper also heard takes that word's time. Words it
    misheard or missed sit between the nearest matched words. A line where
    under half the words matched is marked unsure, so the board can flag it.
    """
    import difflib

    tokens = []
    owner = []
    for index, row in enumerate(rows):
        pieces = norm_tokens(row) or ["_"]
        tokens.extend(pieces)
        owner.extend([index] * len(pieces))
    heard = [word[0] for word in words]
    times = [None] * len(tokens)
    matched = [False] * len(tokens)
    blocks = difflib.SequenceMatcher(None, tokens, heard, autojunk=False).get_matching_blocks()
    for block in blocks:
        for offset in range(block.size):
            word = words[block.b + offset]
            times[block.a + offset] = (word[1], word[2])
            matched[block.a + offset] = True
    total = song_seconds if song_seconds > 0 else (words[-1][2] if words else 0.0)
    total = max(total, 1.0)
    # Fill unmatched runs between the nearest anchors, in proportion.
    index = 0
    while index < len(tokens):
        if times[index] is not None:
            index += 1
            continue
        run_end = index
        while run_end < len(tokens) and times[run_end] is None:
            run_end += 1
        left = times[index - 1][1] if index > 0 else 0.0
        right = times[run_end][0] if run_end < len(tokens) else total
        if right < left:
            right = left
        count = run_end - index
        step = (right - left) / count if count else 0
        for k in range(count):
            times[index + k] = (left + k * step, left + (k + 1) * step)
        index = run_end
    lines = []
    for row_index, text in enumerate(rows):
        spots = [i for i, own in enumerate(owner) if own == row_index]
        start = times[spots[0]][0]
        end = times[spots[-1]][1]
        hits = sum(1 for i in spots if matched[i])
        lines.append({
            "start": start,
            "end": end,
            "text": text,
            "sure": hits * 2 >= len(spots),
        })
    # Keep lines in order with no overlaps, and never zero length.
    for index, line in enumerate(lines):
        if index:
            line["start"] = max(line["start"], lines[index - 1]["end"])
        line["end"] = max(line["end"], line["start"] + 0.3)
        line["start"] = round(line["start"], 2)
        line["end"] = round(line["end"], 2)
    return lines


async def run_whisper(song: Path, key: str, prompt: str) -> dict:
    tag = hashlib.sha256(f"{WHISPER_MODEL}\0{prompt}".encode()).hexdigest()[:10]
    cached = CACHE_DIR / f"{key}.whisper.{tag}.json"
    if cached.is_file():
        try:
            return json.loads(cached.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
    out_dir = CACHE_DIR / f"run-{uuid.uuid4().hex[:8]}"
    out_dir.mkdir()
    args = [
        "whisper", str(song),
        "--model", WHISPER_MODEL,
        "--device", "cpu",
        "--fp16", "False",
        "--word_timestamps", "True",
        "--output_format", "json",
        "--output_dir", str(out_dir),
        "--verbose", "False",
    ]
    if prompt:
        # Knowing the words helps Whisper hear them through the music.
        args.extend(["--initial_prompt", prompt[:800]])
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=1800)
        except asyncio.TimeoutError:
            proc.kill()
            raise HTTPException(504, "Transcription took too long.")
        if proc.returncode != 0:
            tail = (stderr or stdout or b"").decode("utf-8", "replace").strip().splitlines()
            detail = tail[-1][:300] if tail else "Whisper failed."
            raise HTTPException(500, detail)
        found = list(out_dir.glob("*.json"))
        if not found:
            raise HTTPException(500, "Whisper did not write a transcript.")
        payload = json.loads(found[0].read_text(encoding="utf-8"))
    finally:
        for leftover in out_dir.glob("*"):
            leftover.unlink()
        out_dir.rmdir()
    cached.write_text(json.dumps(payload), encoding="utf-8")
    return payload


def saved_lyrics_path(key: str) -> Path:
    return CACHE_DIR / f"{key}.lyrics.json"


def clean_lines(value) -> list:
    lines = []
    if not isinstance(value, list):
        return lines
    for item in value[:2000]:
        if not isinstance(item, dict):
            continue
        text = re.sub(r"\s+", " ", str(item.get("text") or "")).strip()[:300]
        if not text:
            continue
        try:
            start = float(item.get("start") or 0)
            end = float(item.get("end") or 0)
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(start) and math.isfinite(end)) or start < 0 or end < start:
            continue
        lines.append({
            "start": round(start, 2),
            "end": round(end, 2),
            "text": text,
            "sure": item.get("sure") is not False,
        })
    return lines


def write_lyrics(folder: Path, key: str, lines: list, source: str) -> dict:
    record = {"song": key, "source": source, "lines": lines}
    blob = json.dumps(record, indent=2)
    saved_lyrics_path(key).write_text(blob, encoding="utf-8")
    (folder / "lyrics.json").write_text(blob, encoding="utf-8")
    # transcript.json is what the phone client and older boards read.
    (folder / "transcript.json").write_text(
        json.dumps({"text": " ".join(line["text"] for line in lines), "lines": lines}, indent=2),
        encoding="utf-8",
    )
    return record


@app.get("/api/project/{project_id}/lyrics")
async def get_lyrics(project_id: str):
    # The lyrics last saved for this song, from any project that used it.
    folder = project_folder(project_id)
    timeline = read_timeline(folder)
    song = song_file(folder, timeline)
    key = await asyncio.to_thread(song_key, song)
    path = saved_lyrics_path(key)
    if not path.is_file():
        return {"lines": [], "source": ""}
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"lines": [], "source": ""}
    return {"lines": clean_lines(record.get("lines")), "source": str(record.get("source") or "")}


@app.post("/api/project/{project_id}/lyrics")
async def save_lyrics(project_id: str, body: dict = Body(...)):
    # Board only. Called after every correction, so a fix is made once.
    folder = project_folder(project_id)
    timeline = read_timeline(folder)
    song = song_file(folder, timeline)
    key = await asyncio.to_thread(song_key, song)
    lines = clean_lines((body or {}).get("lines"))
    source = str((body or {}).get("source") or "edited")[:20]
    write_lyrics(folder, key, lines, source)
    return {"ok": True, "lines": len(lines)}


@app.post("/api/project/{project_id}/transcribe")
async def transcribe(project_id: str, body: dict | None = Body(default=None)):
    """Timed lyric lines for the song.

    With lyrics in the body: an .lrc file is used as it is, and plain text is
    matched to the song's audio, so the words are yours and the times are
    the song's. With no body: Whisper's own words. Whisper runs once per song
    (and per lyric sheet); after that the result comes from the cache.
    """
    folder = project_folder(project_id)
    timeline = read_timeline(folder)
    song = song_file(folder, timeline)
    body = body if isinstance(body, dict) else {}
    lyrics = str(body.get("lyrics") or "")[:20000]
    key = await asyncio.to_thread(song_key, song)
    lrc = parse_lrc(lyrics)
    if lrc:
        record = write_lyrics(folder, key, lrc, "lrc")
        return {"lines": record["lines"], "text": " ".join(line["text"] for line in lrc), "source": "lrc", "unsure": 0}
    rows = lyric_rows(lyrics)
    prompt = " ".join(rows) if rows else ""
    payload = await run_whisper(song, key, prompt)
    if rows:
        try:
            seconds = await media_duration(song)
        except HTTPException:
            seconds = 0.0
        lines = align_lyrics(rows, heard_words(payload), seconds)
        source = "aligned"
    else:
        lines = []
        for segment in payload.get("segments") or []:
            text = str(segment.get("text") or "").strip()
            if not text:
                continue
            lines.append({
                "start": round(float(segment.get("start") or 0), 2),
                "end": round(float(segment.get("end") or 0), 2),
                "text": text,
                "sure": True,
            })
        source = "whisper"
    if not lines:
        raise HTTPException(500, "Whisper returned no lines.")
    record = write_lyrics(folder, key, lines, source)
    unsure = sum(1 for line in record["lines"] if not line["sure"])
    return {
        "lines": record["lines"],
        "text": " ".join(line["text"] for line in record["lines"]),
        "source": source,
        "unsure": unsure,
    }


@app.post("/api/suggest-prompt")
async def suggest_prompt(body: dict = Body(...)):
    lyrics = str(body.get("lyrics") or "").strip()
    broll = body.get("broll") is True
    if len(lyrics) < 2 and not broll:
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
    if broll:
        # An instrumental stretch with no words of its own. The shot belongs
        # to the lines around it and must not repeat its neighbours.
        before = str(body.get("before") or "").strip()[:600]
        after = str(body.get("after") or "").strip()[:600]
        avoid = [str(item).strip()[:300] for item in (body.get("avoid") or []) if str(item).strip()][:6]
        try:
            index = max(1, int(body.get("index") or 1))
            total = max(index, int(body.get("total") or 1))
        except (TypeError, ValueError):
            index, total = 1, 1
        user = "\n".join([
            "Feel: " + (feel or "unspecified"),
            "Master direction: " + (master or "none"),
            "Characters: " + ("; ".join(characters) or "none"),
            "Lyrics just before: " + (before or "none, this is the opening"),
            "Lyrics just after: " + (after or "none, this is the ending"),
            f"Shot {index} of {total} in this instrumental stretch.",
            "Already used here: " + (" | ".join(avoid) or "nothing yet"),
        ])
        system = (
            "You write one image prompt for a B-roll still in an instrumental part of a music video. "
            "Show the world of the song between the words: the setting, a telling detail, the light, "
            "or the characters in a quiet moment. Stay in the same place and story as the lyrics around it. The feel, room, and character are added separately, so do not repeat them. "
            "Make it clearly different from anything already used: change the subject, angle, or distance. "
            "One or two sentences describing what the camera sees. "
            "Do not quote lyrics. Do not add a title, labels, or quotation marks. "
            "No readable text in the scene. Keep figures distant."
        )
    else:
        user = "\n".join([
            "Feel: " + (feel or "unspecified"),
            "Master direction: " + (master or "none"),
            "Characters: " + ("; ".join(characters) or "none"),
            "Lyrics: " + lyrics[:1500],
        ])
        system = (
            "You write one image prompt for a music-video still. "
            "Describe what the camera sees in this lyric span, in one or two sentences. "
            "Describe only what is specific to this shot: pose, action, framing, and anything about the room or light that differs. The feel, room, and character are added separately, so do not repeat them. "
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
        role = str(body.get("role") or "").strip()
        if role in CARD_ROLES:
            section["role"] = role
        if "reference" in body:
            pick = str(body.get("reference") or "")
            if pick and pick != "none" and not REF_RE.fullmatch(pick):
                pick = ""
            section["reference"] = pick
        reference = reference_for(folder, timeline, section)
        prompt = compose_prompt(timeline, section, with_master=reference is None)
        if len(prompt.strip()) < 8:
            raise HTTPException(400, "Write a prompt or drop lyrics onto this shot first.")
        cost = IMAGE_COST
        if reference is not None:
            prompt = REF_LEAD + prompt[: 2000 - len(REF_LEAD)]
            cost = round(IMAGE_COST + IMAGE_INPUT_COST, 3)
        raw = await imagine(prompt, reference)
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
            "cost": cost,
            "reference": bool(reference),
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


def save_reference(folder: Path, timeline: dict, raw: bytes, name: str) -> dict:
    ref_id = "r" + uuid.uuid4().hex[:6]
    url = store_still(folder, ref_id, raw)
    items = reference_list(timeline)
    items.append({"id": ref_id, "name": (name or "").strip()[:60] or f"Reference {len(items) + 1}", "image": url})
    timeline["references"] = items
    if not timeline.get("reference_default") or len(items) == 1:
        timeline["reference_default"] = ref_id
    write_timeline(folder, timeline)
    return reference_state(timeline)


@app.get("/api/project/{project_id}/references")
async def get_references(project_id: str):
    return reference_state(read_timeline(project_folder(project_id)))


@app.post("/api/project/{project_id}/references/generate")
async def generate_reference(project_id: str, body: dict = Body(...)):
    # A reference is drawn from scratch. Blank prompt: the setting from the
    # master prompt with nobody in it, ready for every shot to build on.
    folder = project_folder(project_id)
    timeline = read_timeline(folder)
    body = body if isinstance(body, dict) else {}
    feel = str(body.get("feel") if "feel" in body else timeline.get("feel") or "").strip()[:1000]
    master = str(body.get("master_prompt") if "master_prompt" in body else timeline.get("master_prompt") or "").strip()[:2000]
    wanted = str(body.get("prompt") or "").strip()[:1500]
    parts = [piece for piece in (feel, master) if piece]
    if wanted:
        parts.append(wanted)
    else:
        parts.append("Establishing shot of the setting, empty, with no people in it")
    parts.append("Reference image, cinematic 16:9 still, clear and well composed, no readable text, no logos")
    prompt = ". ".join(part.rstrip(" .") for part in parts)[:2000]
    if len(prompt) < 40 and not wanted:
        raise HTTPException(400, "Describe the reference, or fill in the master prompt first.")
    raw = await imagine(prompt)
    if len(raw) < 500:
        raise HTTPException(502, "Imagine returned an empty image.")
    timeline = read_timeline(folder)
    state = save_reference(folder, timeline, raw, str(body.get("name") or ""))
    print(f"reference {project_id} generated", flush=True)
    return {**state, "cost": IMAGE_COST, "prompt": prompt}


@app.post("/api/project/{project_id}/references/upload")
async def upload_reference(project_id: str, file: UploadFile = File(...), name: str = Form("")):
    folder = project_folder(project_id)
    raw = await file.read()
    if len(raw) > MAX_STILL:
        raise HTTPException(413, "The image must be 20 MB or smaller.")
    if not image_ext(raw):
        raise HTTPException(400, "Use a JPEG, PNG, or WebP.")
    base = Path(file.filename or "").stem[:60]
    return save_reference(folder, read_timeline(folder), raw, name or base)


@app.post("/api/project/{project_id}/references/from-still")
async def reference_from_still(project_id: str, body: dict = Body(...)):
    # Any still on the board can become a reference.
    folder = project_folder(project_id)
    path = still_file(folder, str((body or {}).get("image") or ""))
    return save_reference(folder, read_timeline(folder), path.read_bytes(), str((body or {}).get("name") or ""))


@app.post("/api/project/{project_id}/references/{ref_id}/edit")
async def edit_reference(project_id: str, ref_id: str, body: dict = Body(...)):
    # Change one reference with words. The result is saved as a new
    # reference next to the old one, so nothing is lost if the edit misses.
    if not REF_RE.fullmatch(ref_id):
        raise HTTPException(404, "Reference not found")
    folder = project_folder(project_id)
    timeline = read_timeline(folder)
    item = next((entry for entry in reference_list(timeline) if entry["id"] == ref_id), None)
    if item is None:
        raise HTTPException(404, "Reference not found")
    wanted = str((body or {}).get("prompt") or "").strip()[:1500]
    if len(wanted) < 4:
        raise HTTPException(400, "Say what to change.")
    source = still_file(folder, item["image"])
    prompt = (
        "Edit this image. Change only what is described here and keep everything else exactly "
        "the same: the camera position, the layout, the light, and every object. " + wanted
    )
    raw = await imagine(prompt, source)
    if len(raw) < 500:
        raise HTTPException(502, "Imagine returned an empty image.")
    name = str((body or {}).get("name") or "").strip()[:60] or (item["name"][:52] + " (edit)")
    state = save_reference(folder, read_timeline(folder), raw, name)
    state["new_id"] = state["references"][-1]["id"]
    state["cost"] = round(IMAGE_COST + IMAGE_INPUT_COST, 3)
    print(f"reference {project_id} {ref_id} edited", flush=True)
    return state


@app.post("/api/project/{project_id}/references/{ref_id}")
async def update_reference(project_id: str, ref_id: str, body: dict = Body(...)):
    if not REF_RE.fullmatch(ref_id):
        raise HTTPException(404, "Reference not found")
    folder = project_folder(project_id)
    timeline = read_timeline(folder)
    items = reference_list(timeline)
    item = next((entry for entry in items if entry["id"] == ref_id), None)
    if item is None:
        raise HTTPException(404, "Reference not found")
    if "name" in (body or {}):
        item["name"] = str(body.get("name") or "").strip()[:60] or item["name"]
    if (body or {}).get("default") is True:
        timeline["reference_default"] = ref_id
    timeline["references"] = items
    write_timeline(folder, timeline)
    return reference_state(timeline)


@app.delete("/api/project/{project_id}/references/{ref_id}")
async def delete_reference(project_id: str, ref_id: str):
    if not REF_RE.fullmatch(ref_id):
        raise HTTPException(404, "Reference not found")
    folder = project_folder(project_id)
    timeline = read_timeline(folder)
    items = [entry for entry in reference_list(timeline) if entry["id"] != ref_id]
    timeline["references"] = items
    if timeline.get("reference_default") == ref_id:
        timeline["reference_default"] = items[0]["id"] if items else ""
    for section in timeline.get("sections") or []:
        if isinstance(section, dict) and section.get("reference") == ref_id:
            section["reference"] = ""
    for old in (folder / "stills").glob(ref_id + ".*"):
        if STILL_RE.fullmatch(old.name):
            old.unlink()
    write_timeline(folder, timeline)
    return reference_state(timeline)


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


def ace_headers() -> dict:
    headers = {"Content-Type": "application/json"}
    token = os.getenv("ACESTEP_API_KEY", "").strip()
    if token:
        headers["Authorization"] = "Bearer " + token
    return headers


def oom_message(text: str) -> str:
    low = (text or "").lower()
    if "out of memory" in low or "outofmemory" in low or "cuda oom" in low or "oom" in low:
        return "ACE-Step ran out of memory. Try a shorter length, or free the GPU."
    return ""


def public_ace_error(message: str, fallback: str) -> str:
    text = (message or "").strip()
    low = text.lower()
    if not text or "xai-" in low or "bearer " in low or "api_key" in low:
        return fallback
    hit = oom_message(text)
    if hit:
        return hit
    if "not initialized" in low or "model not" in low or "not ready" in low or "no model" in low:
        return "ACE-Step is up, but the model is not ready. Wait until it finishes loading."
    return text[:300]


def ace_down() -> HTTPException:
    return HTTPException(
        503,
        "ACE-Step is not running on TEC (the-empty-chair:8001). "
        "This machine does not load that model.",
    )


def unwrap_ace(response: httpx.Response) -> dict:
    try:
        payload = response.json()
    except Exception:
        payload = {}
    if response.status_code == 401:
        raise HTTPException(502, "ACE-Step rejected ACESTEP_API_KEY.")
    detail = ""
    if isinstance(payload, dict):
        err = payload.get("error")
        if isinstance(err, str):
            detail = err
        elif payload.get("detail"):
            detail = str(payload.get("detail"))
    if response.status_code >= 400 or (isinstance(payload, dict) and payload.get("code") not in (None, 200)):
        raise HTTPException(502, public_ace_error(detail, "ACE-Step refused the request."))
    return payload if isinstance(payload, dict) else {}


async def ace_post(client: httpx.AsyncClient, path: str, body: dict) -> dict:
    try:
        response = await client.post(AUDIO_GEN_URL + path, headers=ace_headers(), json=body)
    except httpx.ConnectError:
        raise ace_down()
    except httpx.TimeoutException:
        raise HTTPException(504, "ACE-Step did not answer in time.")
    return unwrap_ace(response)


def task_state(item: dict) -> str:
    raw = item.get("status")
    if raw in (1, "1", "succeeded", "success"):
        return "ok"
    if raw in (2, "2", "failed", "failure", "error"):
        return "fail"
    return "wait"


def parse_ace_result(raw):
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return raw.strip()
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            return [parsed]
    return []


def ace_download_url(file_ref: str) -> str:
    ref = (file_ref or "").strip()
    if ref.startswith("/v1/audio"):
        return AUDIO_GEN_URL + ref
    if ref.startswith(AUDIO_GEN_URL + "/v1/audio"):
        return ref
    raise HTTPException(502, "ACE-Step did not return an audio file.")


def audio_kind(raw: bytes) -> str:
    if raw.startswith(b"ID3") or (len(raw) > 2 and raw[0] == 0xFF and (raw[1] & 0xE0) == 0xE0):
        return "mp3"
    if len(raw) >= 12 and raw.startswith(b"RIFF") and raw[8:12] == b"WAVE":
        return "wav"
    return ""


# Turbo was trained on captions that name a singer. A short mood with real
# lyrics and no vocal word often comes back as an instrumental bed.
_VOCAL_HINT = re.compile(
    r"\b(vocal|vocals|singer|singers|singing|sung|voice|voices|choir|rap|rapping|rapper)\b",
    re.I,
)
_INSTRUMENTAL_HINT = re.compile(r"\b(no\s+vocals?|instrumentals?)\b", re.I)


# ACE-Step accepts about 10–600 seconds. A preset is only for a forced length.
ACE_MIN_SECONDS = 10.0
ACE_MAX_SECONDS = 600.0
# Turbo with the LM off does not pack a line into a couple of seconds. A 44
# second track of a 20-line sheet only sang three lines, so each sung line
# gets its own phrase. A [Verse] or [Chorus] tag is a break, not a lyric.
# Intro and outro keep the first and last lines from being the ones cut off.
LYRIC_LINE_SECONDS = 15.0
LYRIC_SECTION_SECONDS = 4.0
LYRIC_EDGE_SECONDS = 8.0
_SECTION_LINE = re.compile(r"\[[^\]\n]{1,48}\]")


def length_label(seconds: int) -> str:
    minutes, rest = divmod(int(seconds), 60)
    return f"{minutes}:{rest:02d}"


def lyric_seconds(lyrics: str) -> float | None:
    """Seconds the sheet needs so every line can be sung.

    None when the sheet is blank. The result is not snapped to 15, 30, 60,
    or any other preset.
    """
    text = lyrics.strip()
    if not text:
        return None
    lines = [line.strip() for line in text.splitlines() if line.strip()] or [text]
    sung = 0
    sections = 0
    for line in lines:
        if _SECTION_LINE.fullmatch(line):
            sections += 1
        else:
            sung += 1
    if sung == 0:
        sung = len(lines)
        sections = 0
    words = re.findall(r"[A-Za-z0-9']+", text)
    by_lines = sung * LYRIC_LINE_SECONDS + sections * LYRIC_SECTION_SECONDS + LYRIC_EDGE_SECONDS * 2
    # A long line still needs about a second per word.
    return max(by_lines, len(words) * 1.0, 8.0)


def read_duration(body: dict) -> tuple[str, int]:
    """('omit', 0), ('fit', -1), or ('preset', seconds)."""
    if "duration" in body:
        raw = body.get("duration")
    elif "audio_duration" in body:
        raw = body.get("audio_duration")
    else:
        return "omit", 0
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return "omit", 0
    try:
        value = int(float(raw))
    except (TypeError, ValueError):
        raise HTTPException(400, "Length must be 15 seconds to 5 minutes, or full song.")
    if value <= 0:
        return "fit", -1
    if value not in GEN_LENGTHS:
        raise HTTPException(400, "Length must be 15 seconds to 5 minutes, or full song.")
    return "preset", value


def full_song_duration(lyrics: str) -> float:
    """Seconds to ask ACE-Step for so every lyric line has time.

    Duration <= 0 is the model's auto length. With the 5Hz LM left off, this
    ACE-Step build turns that into a fixed 120 second track. The estimate is
    clamped to 10–600 seconds and is not rounded onto a preset.
    """
    seconds = lyric_seconds(lyrics)
    if seconds is None:
        raise HTTPException(400, "Pick a length for an instrumental track.")
    if seconds > ACE_MAX_SECONDS:
        raise HTTPException(
            400,
            "These lyrics look longer than 10:00, which is as long as a generated track can be. Shorten them, then generate.",
        )
    return round(min(ACE_MAX_SECONDS, max(ACE_MIN_SECONDS, seconds)), 1)


def lyric_fit_check(lyrics: str, preset: int) -> None:
    """Warn when a forced preset is clearly shorter than the sheet."""
    seconds = lyric_seconds(lyrics)
    if seconds is None:
        return
    if seconds > ACE_MAX_SECONDS:
        raise HTTPException(
            400,
            "These lyrics look longer than 10:00, which is as long as a generated track can be. Shorten them, then generate.",
        )
    if seconds > float(preset) + 4:
        raise HTTPException(409, {
            "message": f"These lyrics won't fit in {length_label(preset)}. Fit the song to the lyrics?",
            "needed": -1,
            "duration": preset,
        })


def ace_caption(style: str, lyrics: str) -> tuple[str, bool]:
    """Blank lyrics stay instrumental. Any other lyrics are sung."""
    caption = " ".join(style.split())
    if not lyrics:
        return caption[:1000], True
    caption = " ".join(_INSTRUMENTAL_HINT.sub(" ", caption).split()).strip(" ,.;")
    if not caption:
        caption = "vocal"
    elif not _VOCAL_HINT.search(caption):
        suffix = ", vocal"
        caption = caption[: 1000 - len(suffix)].rstrip(" ,.;") + suffix
    return caption[:1000], False


@app.post("/api/generate-audio")
async def generate_audio(body: dict = Body(...)):
    # ACE-Step 1.5 HTTP API on TEC. Change AUDIO_GEN_URL to move the model.
    # release_task -> poll query_result -> download /v1/audio. thinking and
    # the caption/language rewriters stay off so a missing 5Hz LM is not required.
    global _audio_job
    if not isinstance(body, dict):
        raise HTTPException(400, "Write a style or mood first.")
    style = str(body.get("prompt") or body.get("style") or "").strip()
    if len(style) < 2:
        raise HTTPException(400, "Write a style or mood first.")
    lyrics = str(body.get("lyrics") or "").strip()[:12000]
    # The lyric box is what the singer uses. The mood field is left as typed.
    caption, instrumental = ace_caption(style, lyrics)
    if _audio_job:
        raise HTTPException(409, "Audio is already generating.")
    mode, preset = read_duration(body)
    if mode == "omit":
        mode = "fit" if lyrics else "preset"
        preset = 30
    # A forced preset that cannot hold the sheet asks before ACE-Step runs.
    # Agreeing sends full-song mode (duration -1), which is sized from the words.
    if mode == "fit":
        audio_duration = full_song_duration(lyrics)
    else:
        lyric_fit_check(lyrics, preset)
        audio_duration = preset
    _audio_job = True
    try:
        request = {
            "prompt": caption,
            "lyrics": "" if instrumental else lyrics,
            "instrumental": instrumental,
            "audio_duration": audio_duration,
            "audio_format": "mp3",
            "batch_size": 1,
            "inference_steps": 8,
            "thinking": False,
            "use_format": False,
            "use_cot_caption": False,
            "use_cot_language": False,
            "task_type": "text2music",
        }
        timeout = httpx.Timeout(30.0, read=90.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            created = await ace_post(client, "/release_task", request)
            data = created.get("data") if isinstance(created.get("data"), dict) else {}
            task_id = str(data.get("task_id") or "").strip()
            if not task_id:
                raise HTTPException(502, "ACE-Step did not start a task.")
            deadline = time.monotonic() + max(480, int(audio_duration) * 8)
            file_ref = ""
            while True:
                if time.monotonic() > deadline:
                    raise HTTPException(504, "Audio generation timed out.")
                await asyncio.sleep(2)
                found = await ace_post(client, "/query_result", {"task_id_list": [task_id]})
                rows = found.get("data")
                if isinstance(rows, dict):
                    rows = [rows]
                item = None
                if isinstance(rows, list):
                    item = next(
                        (row for row in rows if isinstance(row, dict) and str(row.get("task_id") or "") == task_id),
                        None,
                    )
                    if item is None and len(rows) == 1 and isinstance(rows[0], dict):
                        item = rows[0]
                state = task_state(item) if item else "wait"
                if state == "wait":
                    continue
                parsed = parse_ace_result(item.get("result"))
                if state == "fail":
                    detail = item.get("error") or ""
                    if isinstance(parsed, str):
                        detail = detail or parsed
                    elif isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
                        detail = detail or parsed[0].get("error") or parsed[0].get("message") or ""
                    raise HTTPException(502, public_ace_error(str(detail), "ACE-Step could not generate that track."))
                if isinstance(parsed, list):
                    for piece in parsed:
                        if isinstance(piece, dict) and piece.get("file"):
                            file_ref = str(piece["file"])
                            break
                if not file_ref:
                    raise HTTPException(502, "ACE-Step finished without an audio file.")
                break
            url = ace_download_url(file_ref)
            try:
                download = await client.get(url, headers=ace_headers(), timeout=120)
            except httpx.ConnectError:
                raise ace_down()
            except httpx.TimeoutException:
                raise HTTPException(504, "ACE-Step did not finish sending the audio.")
        if download.status_code >= 400 or len(download.content) < 1000:
            raise HTTPException(502, "ACE-Step did not return a usable audio file.")
        kind = audio_kind(download.content)
        if not kind:
            raise HTTPException(502, "ACE-Step returned a file that is not audio.")
        name = "g" + uuid.uuid4().hex[:8] + "." + kind
        dest = GENERATED_DIR / name
        dest.write_bytes(download.content)
        try:
            heard = await media_duration(dest)
        except HTTPException:
            heard = float(audio_duration)
        return {
            "url": "/api/generated/" + name,
            "name": name,
            "path": str(dest),
            "duration": round(float(heard), 1),
            "lyrics": lyrics,
            "status": "Track ready. Play it, or use it as the song.",
        }
    finally:
        _audio_job = False


@app.get("/api/generated/{filename}")
async def generated_audio(filename: str):
    if not GEN_RE.fullmatch(filename or ""):
        raise HTTPException(404, "Audio not found")
    path = GENERATED_DIR / filename
    if not path.is_file():
        raise HTTPException(404, "Audio not found")
    return FileResponse(path)


BEATS_VERSION = 1
_beats_lock = asyncio.Lock()


def detect_beats(path: Path) -> dict:
    # Runs in a worker thread. librosa is optional: without it the board
    # still fills gaps, it just cuts on even spacing instead of on the beat.
    import librosa
    import numpy as np

    y, sr = librosa.load(str(path), sr=22050, mono=True)
    onset = librosa.onset.onset_strength(y=y, sr=sr)
    tempo, frames = librosa.beat.beat_track(onset_envelope=onset, sr=sr, units="frames")
    frames = np.asarray(frames, dtype=int)
    times = librosa.frames_to_time(frames, sr=sr)
    bars = []
    if len(frames) >= 4:
        # A bar line is the beat of every four that hits hardest.
        strength = [float(onset[frames[phase::4]].sum()) for phase in range(4)]
        best = int(max(range(4), key=lambda phase: strength[phase]))
        bars = [round(float(t), 3) for t in times[best::4]]
    return {
        "available": True,
        "tempo": round(float(np.atleast_1d(tempo)[0]), 1),
        "beats": [round(float(t), 3) for t in times],
        "bars": bars,
    }


@app.get("/api/project/{project_id}/beats")
async def song_beats(project_id: str):
    folder = project_folder(project_id)
    timeline = read_timeline(folder)
    song = song_file(folder, timeline)
    stat = song.stat()
    key = f"{BEATS_VERSION}:{song.name}:{stat.st_size}:{int(stat.st_mtime)}"
    cache = folder / "beats.json"
    async with _beats_lock:
        if cache.is_file():
            try:
                saved = json.loads(cache.read_text(encoding="utf-8"))
                if saved.get("key") == key:
                    return saved["result"]
            except (OSError, json.JSONDecodeError, KeyError):
                pass
        try:
            import librosa  # noqa: F401
        except ImportError:
            return {
                "available": False,
                "tempo": 0,
                "beats": [],
                "bars": [],
                "note": "Install librosa on this machine to cut on the beat.",
            }
        try:
            result = await asyncio.to_thread(detect_beats, song)
        except Exception as exc:
            print(f"beats {project_id} failed: {type(exc).__name__}", flush=True)
            return {
                "available": False,
                "tempo": 0,
                "beats": [],
                "bars": [],
                "note": "Could not find the beat in this song.",
            }
        cache.write_text(json.dumps({"key": key, "result": result}), encoding="utf-8")
        print(f"beats {project_id} {result['tempo']} bpm {len(result['beats'])} beats", flush=True)
        return result


CLIP_NAME_RE = re.compile(r"^([A-Za-z0-9_-]{1,40})_(\d+)\.mp4$")


@app.get("/api/project/{project_id}/clips")
async def list_motion_clips(project_id: str):
    # Flutter client only. The web board does not call this.
    # Names and relative URLs of cached motion clips, never file contents.
    folder = project_folder(project_id)
    clips_dir = (folder / "clips").resolve()
    items = []
    names = []
    if clips_dir.is_dir():
        try:
            names = sorted(path.name for path in clips_dir.iterdir() if path.is_file())
        except OSError:
            names = []
    for name in names:
        match = CLIP_NAME_RE.fullmatch(name)
        if not match:
            continue
        path = (clips_dir / name).resolve()
        try:
            path.relative_to(clips_dir)
        except ValueError:
            continue
        if not path.is_file() or path.stat().st_size < 1000:
            continue
        section_id = match.group(1)
        index = int(match.group(2))
        items.append({
            "section_id": section_id,
            "index": index,
            "url": f"/api/project/{quote(project_id, safe='')}/clips/{section_id}/{index}",
        })
    return {"clips": items}


@app.get("/api/project/{project_id}/clips/{section_id}/{index}")
async def motion_clip(project_id: str, section_id: str, index: int):
    # Flutter client only. The web board does not call this.
    if not SECTION_RE.fullmatch(section_id or "") or index < 0 or index > 80:
        raise HTTPException(404, "Clip not found")
    folder = project_folder(project_id)
    clips_dir = (folder / "clips").resolve()
    path = (clips_dir / f"{section_id}_{index}.mp4").resolve()
    try:
        path.relative_to(clips_dir)
    except ValueError:
        raise HTTPException(404, "Clip not found")
    if not path.is_file() or path.stat().st_size < 1000:
        raise HTTPException(404, "Clip not found")
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=path.name,
        headers={"Cache-Control": "no-cache"},
    )


FIX_SYSTEM = """You help fix one shot of a music video, inside OmniVideo, a board that turns a song into a video.

How the board builds a still: it joins the Overall feel, the Master prompt, the Characters, and then the card's own prompt into one image prompt. So the card prompt must describe ONLY what is specific to this shot: who is where, their pose and action, the framing and camera angle, the light if it differs, and anything unusual. Never repeat the feel, the room, or the character's look; the board adds those.

References: a reference image makes the still an edit of that picture, keeping its setting, camera position, objects, and people the same. Good for keeping places consistent. But it holds the camera where the reference was taken, so a shot with a different angle or framing (a close-up, over-the-shoulder, overhead, a mirror detail) usually needs reference "none". Choose "default" to follow the project default, "none" to draw from scratch, or the id of a named reference.

Motion: the clip made from the still follows its own motion prompt. Describe only movement over a few seconds: what moves, how, and what stays still. Leave it empty to keep the current one.

Image models get confused by things like "only in the reflection": name the framing explicitly, say what is in the foreground and background, and repeat a hard rule once in plain words.

Reply with ONLY a JSON object, no other text:
{"reply": "one or two short sentences to the user about what you changed and why", "prompt": "the full new card prompt", "reference": "default" or "none" or a reference id, "motion": "new motion prompt, or empty string to keep it"}"""


def find_json(text: str) -> dict:
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return {}
    try:
        value = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


@app.post("/api/project/{project_id}/sections/{section_id}/fix")
async def fix_shot(project_id: str, section_id: str, body: dict = Body(...)):
    """Chat about one still. Grok rewrites the card's prompt, reference and
    motion; the board shows the proposal and the user applies it."""
    if not SECTION_RE.fullmatch(section_id):
        raise HTTPException(400, "Bad section id.")
    key = api_key()
    if not key:
        raise HTTPException(400, "No API key is available on this machine.")
    folder = project_folder(project_id)
    timeline = read_timeline(folder)
    body = body if isinstance(body, dict) else {}
    message = str(body.get("message") or "").strip()[:2000]
    if not message:
        raise HTTPException(400, "Say what's wrong with this shot.")
    feel = str(body.get("feel") or timeline.get("feel") or "").strip()[:1000]
    master = str(body.get("master_prompt") or timeline.get("master_prompt") or "").strip()[:2000]
    people = []
    for person in clean_characters(body.get("characters") if "characters" in body else timeline.get("characters")):
        bit = ", ".join(piece for piece in (person["name"], person["look"]) if piece)
        if bit:
            people.append(bit)
    refs = reference_state(timeline)
    ref_lines = [
        f'- id "{item["id"]}": {item["name"]}' + (" (the default)" if item["id"] == refs["default"] else "")
        for item in refs["references"]
    ]
    current_ref = str(body.get("reference") or "")
    context = "\n".join([
        "Overall feel: " + (feel or "none"),
        "Master prompt: " + (master or "none"),
        "Characters: " + ("; ".join(people) or "none"),
        "References:\n" + ("\n".join(ref_lines) or "none yet"),
        "This shot's lyrics: " + (str(body.get("lyrics") or "").strip()[:600] or "none (instrumental)"),
        "This shot's current prompt: " + (str(body.get("prompt") or "").strip()[:1500] or "empty"),
        "This shot's current reference: " + (current_ref or "default"),
        "This shot's current motion prompt: " + (str(body.get("motion") or "").strip()[:800] or "empty"),
    ])
    turns = [{"role": "system", "content": FIX_SYSTEM}, {"role": "user", "content": "Shot details:\n" + context}]
    for item in (body.get("history") or [])[-12:]:
        if not isinstance(item, dict):
            continue
        role = "assistant" if item.get("role") == "assistant" else "user"
        text = str(item.get("content") or "").strip()[:2000]
        if text:
            turns.append({"role": role, "content": text})
    ask = [{"type": "input_text", "text": message}]
    looked = False
    if body.get("look") is True:
        # Let the model see the still it is fixing.
        image = str(body.get("image") or "").split("?", 1)[0]
        if image:
            try:
                path = still_file(folder, image)
                ask.append({
                    "type": "input_image",
                    "image_url": "data:" + image_mime(path) + ";base64," + base64.b64encode(path.read_bytes()).decode("ascii"),
                })
                looked = True
            except HTTPException:
                pass
    turns.append({"role": "user", "content": ask})
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            "https://api.x.ai/v1/responses",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": TEXT_MODEL,
                "store": False,
                "max_output_tokens": 700,
                "input": turns,
            },
        )
    if response.status_code >= 400:
        raise HTTPException(response.status_code, error_text(response, "Could not reach Grok."))
    raw = response_text(response.json())
    data = find_json(raw)
    prompt = str(data.get("prompt") or "").strip().strip('"')[:2000]
    if not prompt:
        reply = (raw or "").strip()[:600] or "No answer came back. Try saying it another way."
        return {"reply": reply, "prompt": "", "reference": current_ref, "motion": "", "looked": looked}
    pick = str(data.get("reference") or "default").strip()
    if pick == "default":
        pick = ""
    elif pick != "none" and pick not in {item["id"] for item in refs["references"]}:
        pick = current_ref if current_ref == "none" or REF_RE.fullmatch(current_ref) else ""
    return {
        "reply": str(data.get("reply") or "Here's a new version.").strip()[:600],
        "prompt": prompt,
        "reference": pick,
        "motion": str(data.get("motion") or "").strip()[:800],
        "looked": looked,
    }


@app.post("/api/suggest-lyrics")
async def suggest_lyrics(body: dict = Body(...)):
    style = str((body or {}).get("prompt") or (body or {}).get("style") or "").strip()
    if len(style) < 2:
        raise HTTPException(400, "Write a style or mood first.")
    key = api_key()
    if not key:
        raise HTTPException(400, "No API key is available. Type the lyrics yourself.")
    system = (
        "You write short song lyrics that match a style. "
        "Use [Verse] and [Chorus] tags. "
        "Eight to sixteen short lines, enough for about thirty seconds. "
        "No title, no explanation, no quotation marks."
    )
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            "https://api.x.ai/v1/responses",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": TEXT_MODEL,
                "store": False,
                "max_output_tokens": 400,
                "input": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": "Style: " + style[:1000]},
                ],
            },
        )
    if response.status_code >= 400:
        raise HTTPException(response.status_code, error_text(response, "Could not suggest lyrics."))
    text = response_text(response.json()).strip().strip('"').strip()
    if text.lower().startswith("lyrics:"):
        text = text.split(":", 1)[1].strip()
    if not text:
        raise HTTPException(502, "No lyrics came back.")
    return {"lyrics": text[:2000]}


@app.get("/api/project/{project_id}/song")
async def project_song(project_id: str):
    # The board's player. FileResponse answers range requests, so seeking works.
    folder = project_folder(project_id)
    song = song_file(folder, read_timeline(folder))
    return FileResponse(song, headers={"Cache-Control": "no-cache"})


@app.get("/api/project/{project_id}/stills/{filename}")
async def still(project_id: str, filename: str):
    if not STILL_RE.fullmatch(filename or ""):
        raise HTTPException(404, "Image not found")
    path = project_folder(project_id) / "stills" / filename
    if not path.is_file():
        raise HTTPException(404, "Image not found")
    return FileResponse(path)


def public_message(message: str, fallback: str) -> str:
    text = re.sub(r"https?://\S+", "", message or "").strip()
    low = text.lower()
    if not text or "xai-" in low or "bearer " in low or "api_key" in low or "data:image" in low:
        return fallback
    return text[:300]


def as_time(value, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise HTTPException(400, label)
    if not math.isfinite(number) or number < 0 or number > 3600:
        raise HTTPException(400, label)
    return number


def clip_pieces(span: float) -> list:
    # The video API bills whole seconds and refuses anything over 15.
    if span <= 0:
        raise HTTPException(400, "A shot has no length.")
    pieces = []
    left = span
    while left > VIDEO_MAX + 1e-6:
        pieces.append(VIDEO_MAX)
        left -= VIDEO_MAX
    last = int(math.ceil(left - 1e-9))
    if last < 1:
        last = 1
    if last > VIDEO_MAX:
        last = VIDEO_MAX
    pieces.append(last)
    return pieces


def still_file(folder: Path, image: str) -> Path:
    name = Path(str(image or "").split("?", 1)[0]).name
    if not STILL_RE.fullmatch(name):
        raise HTTPException(400, "A shot is missing its image.")
    path = folder / "stills" / name
    if not path.is_file():
        raise HTTPException(400, "A shot's image is missing on disk.")
    return path


def image_mime(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if ext == ".png":
        return "image/png"
    if ext == ".webp":
        return "image/webp"
    raise HTTPException(400, "Use a JPEG, PNG, or WebP.")


def clip_digest(image: Path, duration: int, prompt: str) -> str:
    digest = hashlib.sha256()
    digest.update(VIDEO_MODEL.encode())
    digest.update(b"\0")
    digest.update(VIDEO_RESOLUTION.encode())
    digest.update(b"\0")
    digest.update(str(duration).encode())
    digest.update(b"\0")
    digest.update(prompt.encode())
    digest.update(b"\0")
    digest.update(image.read_bytes())
    return digest.hexdigest()


def chain_digest(prev: str, duration: int, prompt: str) -> str:
    # A piece after the first starts from the last frame of the piece before
    # it, so a long shot keeps moving instead of jumping back to the still.
    # That frame does not exist until the earlier piece is made, so the cache
    # key follows the earlier piece's key instead of image bytes.
    digest = hashlib.sha256()
    for part in (VIDEO_MODEL, VIDEO_RESOLUTION, str(duration), prompt, "chain", prev):
        digest.update(part.encode())
        digest.update(b"\0")
    return digest.hexdigest()


def cached_clip(folder: Path, section_id: str, index: int, digest: str):
    path = folder / "clips" / f"{section_id}_{index}.mp4"
    meta_path = path.with_suffix(".json")
    if not path.is_file() or path.stat().st_size < 1000 or not meta_path.is_file():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if meta.get("hash") != digest:
        return None
    return path


def board_timeline(saved: dict, body: dict) -> dict:
    if not isinstance(body, dict):
        body = {}
    feel = body.get("feel") if "feel" in body else saved.get("feel")
    master = body.get("master_prompt") if "master_prompt" in body else saved.get("master_prompt")
    people = body.get("characters") if "characters" in body else saved.get("characters")
    sections = body.get("sections") if isinstance(body.get("sections"), list) else saved.get("sections")
    return {
        "feel": str(feel or "")[:1000],
        "global_style": str(feel or "")[:1000],
        "master_prompt": str(master or "")[:2000],
        "characters": clean_characters(people),
        "sections": sections or [],
    }


def build_video_plan(folder: Path, timeline: dict, song_seconds: float, partial: bool = False) -> dict:
    # partial: the Frames reel asks before every shot has a still. Shots with
    # no still keep their place on the clock but get no pieces.
    raw = []
    missing = 0
    seen = set()
    for section in timeline.get("sections") or []:
        if not isinstance(section, dict):
            continue
        section_id = str(section.get("id") or "")
        if not SECTION_RE.fullmatch(section_id):
            raise HTTPException(400, "A shot has a bad id.")
        if section_id in seen:
            raise HTTPException(400, "Two shots share an id.")
        seen.add(section_id)
        start = as_time(section.get("start"), "A shot has a bad time.")
        end = as_time(section.get("end"), "A shot has a bad time.")
        if end <= start:
            raise HTTPException(400, "A shot ends before it starts.")
        image = str(section.get("image") or "").strip()
        still = None
        if image:
            try:
                still = still_file(folder, image)
            except HTTPException:
                if not partial:
                    raise
        if still is None:
            missing += 1
            if not partial:
                continue
        raw.append({
            "id": section_id,
            "start": start,
            "end": end,
            "image": still,
            "prompt": motion_prompt(timeline, section),
        })
    if missing and not partial:
        noun = "is" if missing == 1 else "are"
        raise HTTPException(400, f"Every shot needs an image first. {missing} {noun} still empty.")
    if not raw:
        raise HTTPException(400, "Add shots to the timeline first.")
    raw.sort(key=lambda item: (item["start"], item["end"], item["id"]))
    for prev, shot in zip(raw, raw[1:]):
        if shot["start"] < prev["end"] - 0.05:
            raise HTTPException(400, "Shots overlap. Move them so each one starts after the previous.")
    song_end = song_seconds if song_seconds > 0 else raw[-1]["end"]
    if song_end < raw[-1]["end"]:
        song_end = raw[-1]["end"]
    # Every second of the song gets moving video. The first shot starts at
    # 0:00 and each shot runs until the next one starts, the last one to the
    # end of the song. A gap the board left open is played by the shot before
    # it (billed), never by a frozen frame. Fill gaps on the board turns long
    # gaps into B-roll cards instead.
    shots = []
    clip_count = 0
    cached = 0
    bill_seconds = 0
    stretched = 0.0
    for index, shot in enumerate(raw):
        start = 0.0 if index == 0 else shot["start"]
        next_time = raw[index + 1]["start"] if index + 1 < len(raw) else song_end
        span = round(next_time - start, 3)
        if span <= 0:
            span = 0.05
        stretched += max(0.0, span - (shot["end"] - shot["start"]))
        pieces = []
        prev_digest = ""
        for piece_index, duration in enumerate(clip_pieces(span) if shot["image"] else []):
            if piece_index == 0:
                digest = clip_digest(shot["image"], duration, shot["prompt"])
            else:
                digest = chain_digest(prev_digest, duration, shot["prompt"])
            prev_digest = digest
            hit = cached_clip(folder, shot["id"], piece_index, digest)
            pieces.append({
                "index": piece_index,
                "duration": duration,
                "hash": digest,
                "cached": hit is not None,
                "path": hit or (folder / "clips" / f"{shot['id']}_{piece_index}.mp4"),
            })
            clip_count += 1
            if hit is not None:
                cached += 1
            else:
                bill_seconds += duration
        shots.append({
            "id": shot["id"],
            "start": round(start, 3),
            "end": round(next_time, 3),
            "lead": 0.0,
            "span": round(span, 3),
            "tail": 0.0,
            "image": shot["image"],
            "prompt": shot["prompt"],
            "pieces": pieces,
        })
    if clip_count > MAX_CLIPS:
        raise HTTPException(400, f"That is {clip_count} clips. Keep it to {MAX_CLIPS} or fewer.")
    new_clips = clip_count - cached
    cost = video_cost(bill_seconds, new_clips)
    stretched = round(stretched, 2)
    if new_clips == 0:
        note = "These clips are already made. Assembling the video does not call the video service."
    else:
        clip_word = "clip" if new_clips == 1 else "clips"
        cached_note = f"{cached} already made. " if cached else ""
        hold_note = ""
        if stretched > 0.25:
            hold_note = (
                f" About {stretched:.0f}s of gaps are covered by running the shot before"
                " each gap longer. Fill gaps on the board turns them into B-roll instead."
            )
        note = (
            f"{cached_note}{new_clips} new {clip_word}, {bill_seconds} seconds of "
            f"{VIDEO_MODEL} at {VIDEO_RESOLUTION}. "
            f"Estimated cost ${cost:.2f} (${VIDEO_RATE:.2f} per second plus "
            f"${VIDEO_IMAGE_COST:.2f} per clip)."
            f"{hold_note} Your song replaces the model's audio."
        )
    return {
        "model": VIDEO_MODEL,
        "resolution": VIDEO_RESOLUTION,
        "song_seconds": round(song_end, 3),
        "shots": shots,
        "clip_count": clip_count,
        "new_clips": new_clips,
        "cached": cached,
        "bill_seconds": bill_seconds,
        "cost": cost,
        "stretched": stretched,
        "note": note,
    }


def video_cost(seconds: float, clips: int) -> float:
    return round(seconds * VIDEO_RATE + clips * VIDEO_IMAGE_COST + 1e-9, 2)


def public_plan(plan: dict) -> dict:
    return {
        "model": plan["model"],
        "resolution": plan["resolution"],
        "rate": VIDEO_RATE,
        "clips": plan["clip_count"],
        "new_clips": plan["new_clips"],
        "cached": plan["cached"],
        "seconds": plan["bill_seconds"],
        "cost": plan["cost"],
        "song_seconds": plan["song_seconds"],
        "note": plan["note"],
    }


async def media_duration(path: Path) -> float:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _stderr = await proc.communicate()
    if proc.returncode != 0:
        raise HTTPException(500, "Could not read the song length.")
    try:
        duration = float(stdout.decode().strip())
    except ValueError:
        raise HTTPException(500, "Could not read the song length.")
    if not math.isfinite(duration) or duration <= 0:
        raise HTTPException(500, "Could not read the song length.")
    return duration


def video_frames(seconds: float) -> int:
    return max(0, int(round(float(seconds) * VIDEO_FPS)))


def video_graph(shots: list, song_index: int, song_seconds: float) -> str:
    # A duration on tpad adds no frames when the clip has no frame duration,
    # and cloned frames reuse one timestamp, so the muxer drops every hold.
    # Count 24 fps frames, then renumber them. build_video_plan already
    # stretches each shot to the next one, so lead and tail are zero and
    # nothing here holds a frozen picture.
    parts = []
    labels = []
    cursor = 0
    total_frames = 0
    for shot_index, shot in enumerate(shots):
        inputs = []
        for _piece in shot["pieces"]:
            inputs.append(f"[{cursor}:v]")
            cursor += 1
        if len(inputs) == 1:
            chain = inputs[0]
        else:
            chain = "".join(inputs) + f"concat=n={len(inputs)}:v=1:a=0,"
        span = max(1, video_frames(shot["span"]))
        lead = video_frames(shot["lead"])
        tail = video_frames(shot["tail"])
        chain += (
            f"fps={VIDEO_FPS},"
            "scale=1280:720:force_original_aspect_ratio=decrease,"
            "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,"
            "setsar=1,"
            f"settb=1/{VIDEO_FPS},"
            "tpad=stop=-1:stop_mode=clone,"
            f"trim=end_frame={span},"
            "setpts=N"
        )
        if lead or tail:
            chain += (
                f",tpad=start={lead}:start_mode=clone:stop={tail}:stop_mode=clone,"
                "setpts=N"
            )
        label = f"[s{shot_index}]"
        chain += label
        parts.append(chain)
        labels.append(label)
        total_frames += lead + span + tail
    if cursor != song_index or total_frames < 1:
        raise HTTPException(500, "Could not assemble the video.")
    picture = total_frames / VIDEO_FPS
    if song_seconds > 0 and abs(picture - song_seconds) > 0.5:
        raise HTTPException(500, "Could not assemble the video.")
    if len(labels) == 1:
        parts[-1] = parts[-1][: -len(labels[0])] + "[outv]"
    else:
        parts.append("".join(labels) + f"concat=n={len(labels)}:v=1:a=0[outv]")
    parts.append(
        f"[{song_index}:a]atrim=duration={picture:.6f},"
        f"apad=whole_dur={picture:.6f},asetpts=PTS-STARTPTS,"
        "aformat=sample_rates=48000:channel_layouts=stereo[outa]"
    )
    return ";".join(parts)


async def assemble_video(shots: list, song: Path, dest: Path, song_seconds: float) -> None:
    args = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    for shot in shots:
        for piece in shot["pieces"]:
            args.extend(["-i", str(piece["path"])])
    song_index = sum(len(shot["pieces"]) for shot in shots)
    args.extend(["-i", str(song)])
    args.extend([
        "-filter_complex",
        video_graph(shots, song_index, song_seconds),
        "-map",
        "[outv]",
        "-map",
        "[outa]",
        "-c:v",
        "libopenh264",
        "-b:v",
        "4M",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        str(dest),
    ])
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=600)
    except asyncio.TimeoutError:
        proc.kill()
        raise HTTPException(500, "Assembling the video took too long.")
    if proc.returncode != 0 or not dest.is_file() or dest.stat().st_size < 1000:
        tail = (stderr or b"").decode("utf-8", "replace").strip().splitlines()
        detail = public_message(tail[-1] if tail else "", "Could not assemble the video.")
        raise HTTPException(500, detail or "Could not assemble the video.")


def video_fail(project_id: str, message: str) -> None:
    global _video_job
    if not _video_job or _video_job.get("project_id") != project_id:
        return
    _video_job["status"] = "error"
    _video_job["error"] = message
    _video_job["step"] = message


def video_step(project_id: str, step: str, done: int) -> None:
    if not _video_job or _video_job.get("project_id") != project_id:
        return
    if _video_job.get("status") != "running":
        return
    _video_job["step"] = step
    _video_job["done"] = done


async def last_frame(clip: Path, dest: Path) -> Path:
    # The final frame of a finished piece seeds the next piece of the same shot.
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-sseof", "-0.25", "-i", str(clip),
        "-update", "1", "-q:v", "2", str(dest),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        await asyncio.wait_for(proc.communicate(), timeout=60)
    except asyncio.TimeoutError:
        proc.kill()
        raise HTTPException(500, "Could not read the end of a clip.")
    if proc.returncode != 0 or not dest.is_file() or dest.stat().st_size < 500:
        raise HTTPException(500, "Could not read the end of a clip.")
    return dest


async def render_clip(client: httpx.AsyncClient, key: str, shot: dict, piece: dict, project_id: str, done: int, total: int, image: Path) -> None:
    video_step(project_id, f"Clip {done + 1} of {total}", done)
    raw = image.read_bytes()
    payload = {
        "model": VIDEO_MODEL,
        "prompt": shot["prompt"],
        "duration": piece["duration"],
        "resolution": VIDEO_RESOLUTION,
        "generate_audio": False,
        "image": {
            "url": "data:" + image_mime(image) + ";base64," + base64.b64encode(raw).decode("ascii"),
        },
    }
    headers = {"Authorization": f"Bearer {key}"}
    response = await client.post("https://api.x.ai/v1/videos/generations", headers=headers, json=payload)
    if response.status_code >= 400:
        raise HTTPException(response.status_code, error_text(response, "Video request failed."))
    try:
        request_id = str(response.json().get("request_id") or "")
    except Exception:
        request_id = ""
    if not request_id:
        raise HTTPException(502, "Video request did not start.")
    deadline = time.monotonic() + 600
    data = {}
    while True:
        result = await client.get(f"https://api.x.ai/v1/videos/{request_id}", headers=headers)
        if result.status_code >= 400:
            raise HTTPException(result.status_code, error_text(result, "Video request failed."))
        try:
            data = result.json()
        except Exception:
            raise HTTPException(502, "Video request failed.")
        status = str(data.get("status") or "")
        if status == "done":
            break
        if status in {"failed", "expired"}:
            err = data.get("error") if isinstance(data.get("error"), dict) else {}
            raise HTTPException(502, public_message(str(err.get("message") or ""), "Video generation failed."))
        progress = data.get("progress")
        if isinstance(progress, int):
            video_step(project_id, f"Clip {done + 1} of {total}, rendering, {progress}%.", done)
        if time.monotonic() > deadline:
            raise HTTPException(504, "A clip took too long.")
        await asyncio.sleep(5)
    video = data.get("video") if isinstance(data.get("video"), dict) else {}
    if video.get("respect_moderation") is False:
        raise HTTPException(502, "A clip was blocked by moderation.")
    url = str(video.get("url") or "")
    if not url.startswith("https://"):
        raise HTTPException(502, "The video service returned no file.")
    download = await client.get(url)
    content = download.content
    if download.status_code >= 400 or len(content) < 1000 or b"ftyp" not in content[:32]:
        raise HTTPException(502, "Could not download a clip.")
    dest = piece["path"]
    dest.parent.mkdir(exist_ok=True)
    part = dest.with_suffix(".part")
    part.write_bytes(content)
    meta = {
        "hash": piece["hash"],
        "duration": piece["duration"],
        "model": VIDEO_MODEL,
        "resolution": VIDEO_RESOLUTION,
    }
    ticks = (data.get("usage") or {}).get("cost_in_usd_ticks") if isinstance(data.get("usage"), dict) else None
    if isinstance(ticks, int):
        meta["ticks"] = ticks
        piece["ticks"] = ticks
    dest.with_suffix(".json").write_text(json.dumps(meta), encoding="utf-8")
    part.replace(dest)
    print(f"video {project_id} clip {done + 1}/{total} {len(content)} bytes", flush=True)


async def run_video(project_id: str, plan: dict, song: Path) -> None:
    global _video_job
    folder = project_folder(project_id)
    total = plan["clip_count"]
    done = 0
    try:
        key = api_key()
        if plan["new_clips"] and not key:
            raise HTTPException(400, "No API key is available on this machine.")
        timeout = httpx.Timeout(30.0, read=180.0, write=180.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            for shot in plan["shots"]:
                for position, piece in enumerate(shot["pieces"]):
                    if piece["cached"]:
                        video_step(project_id, f"Clip {done + 1} of {total}, already made.", done)
                        done += 1
                        continue
                    image = shot["image"]
                    if position > 0:
                        before = shot["pieces"][position - 1]["path"]
                        image = await last_frame(before, before.with_name(before.stem + "_end.jpg"))
                    await render_clip(client, key, shot, piece, project_id, done, total, image)
                    done += 1
                    video_step(project_id, f"Clip {done} of {total} ready.", done)
        video_step(project_id, "Assembling the video.", done)
        dest = folder / "video.part.mp4"
        final = folder / "video.mp4"
        await assemble_video(plan["shots"], song, dest, plan["song_seconds"])
        dest.replace(final)
        ticks = 0
        have_ticks = True
        for shot in plan["shots"]:
            for piece in shot["pieces"]:
                meta_path = piece["path"].with_suffix(".json")
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    have_ticks = False
                    continue
                if not isinstance(meta.get("ticks"), int):
                    have_ticks = False
                else:
                    ticks += meta["ticks"]
        if have_ticks and ticks > 0:
            cost = ticks / 10_000_000_000
            step = f"Video ready. Charged ${cost:.2f}."
        elif plan["cost"] <= 0:
            step = "Video ready."
        else:
            step = f"Video ready. Estimated ${plan['cost']:.2f}."
        timeline = read_timeline(folder)
        timeline["video"] = f"/api/project/{project_id}/video"
        write_timeline(folder, timeline)
        if _video_job and _video_job.get("project_id") == project_id:
            _video_job["status"] = "done"
            _video_job["url"] = timeline["video"]
            _video_job["step"] = step
            _video_job["error"] = ""
            _video_job["done"] = total
        print(f"video {project_id} ready", flush=True)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else "Video failed."
        video_fail(project_id, detail)
        print(f"video {project_id} failed", flush=True)
    except httpx.HTTPError:
        video_fail(project_id, "The video service did not answer.")
        print(f"video {project_id} failed", flush=True)
    except Exception as exc:
        video_fail(project_id, public_message(str(exc), "Video failed."))
        print(f"video {project_id} failed: {type(exc).__name__}", flush=True)


async def prepare_video(project_id: str, body: dict, partial: bool = False) -> tuple:
    folder = project_folder(project_id)
    saved = read_timeline(folder)
    song = song_file(folder, saved)
    timeline = board_timeline(saved, body or {})
    duration = await media_duration(song)
    plan = build_video_plan(folder, timeline, duration, partial=partial)
    return folder, song, plan


def clip_url(project_id: str, shot_id: str, piece: dict) -> str:
    # The hash on the end changes when the clip is remade, so the browser
    # never plays an old take from its cache.
    return (
        f"/api/project/{quote(project_id, safe='')}/clips/{shot_id}/{piece['index']}"
        f"?v={piece['hash'][:10]}"
    )


def clip_rows(project_id: str, plan: dict) -> list:
    rows = []
    for shot in plan["shots"]:
        pieces = shot["pieces"]
        seconds = sum(piece["duration"] for piece in pieces)
        new_seconds = sum(piece["duration"] for piece in pieces if not piece["cached"])
        new_count = sum(1 for piece in pieces if not piece["cached"])
        made = bool(pieces) and all(piece["cached"] for piece in pieces)
        # A clip file from an older prompt or length can still be watched,
        # but generating the video would make it again.
        old = not made and bool(pieces) and all(Path(piece["path"]).is_file() for piece in pieces)
        if not pieces:
            state = "no-still"
        elif made:
            state = "made"
        elif old:
            state = "stale"
        else:
            state = "missing"
        rows.append({
            "id": shot["id"],
            "start": shot["start"],
            "end": shot["end"],
            "seconds": seconds,
            "state": state,
            "urls": [clip_url(project_id, shot["id"], piece) for piece in pieces] if (made or old) else [],
            "cost": video_cost(new_seconds, new_count),
            "redo_cost": video_cost(seconds, len(pieces)),
        })
    return rows


@app.post("/api/project/{project_id}/clips/status")
async def clips_status(project_id: str, body: dict = Body(...)):
    # Board only. One row per shot, in time order, for the Frames reel.
    _folder, _song, plan = await prepare_video(project_id, body, partial=True)
    rows = clip_rows(project_id, plan)
    missing = [row for row in rows if row["state"] in {"missing", "stale"}]
    return {
        "song_seconds": plan["song_seconds"],
        "clips": rows,
        "missing": len(missing),
        "missing_cost": round(sum(row["cost"] for row in missing) + 1e-9, 2),
        "rate": VIDEO_RATE,
    }


async def run_clips(project_id: str, plan: dict, ids: set) -> None:
    global _video_job
    targets = [shot for shot in plan["shots"] if shot["id"] in ids]
    work = [(shot, position, piece) for shot in targets for position, piece in enumerate(shot["pieces"])]
    todo = [item for item in work if not item[2]["cached"]]
    total = len(todo)
    done = 0
    try:
        key = api_key()
        if todo and not key:
            raise HTTPException(400, "No API key is available on this machine.")
        timeout = httpx.Timeout(30.0, read=180.0, write=180.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            for shot, position, piece in todo:
                image = shot["image"]
                if position > 0:
                    before = shot["pieces"][position - 1]["path"]
                    image = await last_frame(before, before.with_name(before.stem + "_end.jpg"))
                await render_clip(client, key, shot, piece, project_id, done, total, image)
                done += 1
                video_step(project_id, f"Clip {done} of {total} ready.", done)
        ticks = 0
        for _shot, _position, piece in todo:
            if isinstance(piece.get("ticks"), int):
                ticks += piece["ticks"]
        noun = "Clip" if len(targets) == 1 else "Clips"
        step = f"{noun} ready. Charged ${ticks / 10_000_000_000:.2f}." if ticks else f"{noun} ready."
        if _video_job and _video_job.get("project_id") == project_id:
            _video_job["status"] = "done"
            _video_job["step"] = step
            _video_job["error"] = ""
            _video_job["done"] = total
        print(f"clips {project_id} ready ({total} new)", flush=True)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else "Clip failed."
        video_fail(project_id, detail)
        print(f"clips {project_id} failed", flush=True)
    except httpx.HTTPError:
        video_fail(project_id, "The video service did not answer.")
        print(f"clips {project_id} failed", flush=True)
    except Exception as exc:
        video_fail(project_id, public_message(str(exc), "Clip failed."))
        print(f"clips {project_id} failed: {type(exc).__name__}", flush=True)


@app.post("/api/project/{project_id}/clips/make")
async def make_clips(project_id: str, body: dict = Body(...)):
    # Board only. Makes clips without assembling the video. "ids" picks the
    # shots (all shots when absent). "redo" makes them again even when the
    # current take is still valid. "cost" must match what the board showed.
    global _video_job, _video_task
    if not isinstance(body, dict) or body.get("confirm") is not True:
        raise HTTPException(400, "Confirm the cost before generating.")
    if _video_job and _video_job.get("status") == "running":
        raise HTTPException(409, "A video or clip is already generating.")
    _folder, _song, plan = await prepare_video(project_id, body, partial=True)
    wanted = body.get("ids")
    if isinstance(wanted, list) and wanted:
        ids = {str(item) for item in wanted}
    else:
        ids = {shot["id"] for shot in plan["shots"]}
    targets = [shot for shot in plan["shots"] if shot["id"] in ids and shot["pieces"]]
    if not targets:
        raise HTTPException(400, "Give that shot a still first.")
    if body.get("redo") is True:
        for shot in targets:
            for piece in shot["pieces"]:
                piece["cached"] = False
    seconds = sum(piece["duration"] for shot in targets for piece in shot["pieces"] if not piece["cached"])
    count = sum(1 for shot in targets for piece in shot["pieces"] if not piece["cached"])
    cost = video_cost(seconds, count)
    try:
        shown = round(float(body.get("cost")), 2)
    except (TypeError, ValueError):
        shown = -1
    if abs(shown - cost) > 0.001:
        raise HTTPException(409, "The estimate changed. Check the cost again.")
    if seconds == 0:
        return {"status": "done", "step": "Those clips are already made.", "cost": 0}
    if not api_key():
        raise HTTPException(400, "No API key is available on this machine.")
    total = sum(1 for shot in targets for piece in shot["pieces"] if not piece["cached"])
    _video_job = {
        "project_id": project_id,
        "kind": "clips",
        "ids": sorted(ids),
        "status": "running",
        "step": "Starting the clip." if total == 1 else "Starting the clips.",
        "done": 0,
        "total": total,
        "cost": cost,
        "url": "",
        "error": "",
    }
    _video_task = asyncio.create_task(run_clips(project_id, plan, {shot["id"] for shot in targets}))
    return {"status": "running", "step": _video_job["step"], "cost": cost}


@app.post("/api/project/{project_id}/video/estimate")
async def video_estimate(project_id: str, body: dict = Body(...)):
    _folder, _song, plan = await prepare_video(project_id, body)
    if plan["new_clips"] and not api_key():
        raise HTTPException(400, "No API key is available on this machine.")
    return public_plan(plan)


@app.post("/api/project/{project_id}/video")
async def start_video(project_id: str, body: dict = Body(...)):
    global _video_job, _video_task
    if not isinstance(body, dict) or body.get("confirm") is not True:
        raise HTTPException(400, "Confirm the cost before generating.")
    if _video_job and _video_job.get("status") == "running":
        raise HTTPException(409, "A video is already generating.")
    _folder, song, plan = await prepare_video(project_id, body)
    try:
        shown = round(float(body.get("cost")), 2)
    except (TypeError, ValueError):
        shown = -1
    if abs(shown - plan["cost"]) > 0.001:
        raise HTTPException(409, "The estimate changed. Check the cost again.")
    if plan["new_clips"] and not api_key():
        raise HTTPException(400, "No API key is available on this machine.")
    _video_job = {
        "project_id": project_id,
        "kind": "video",
        "status": "running",
        "step": "Starting the video.",
        "done": 0,
        "total": plan["clip_count"],
        "cost": plan["cost"],
        "url": "",
        "error": "",
    }
    _video_task = asyncio.create_task(run_video(project_id, plan, song))
    return {"status": "running", **public_plan(plan)}


@app.get("/api/project/{project_id}/video/status")
async def video_status(project_id: str):
    folder = project_folder(project_id)
    if _video_job and _video_job.get("project_id") == project_id:
        return {
            "status": _video_job.get("status") or "idle",
            "kind": _video_job.get("kind") or "video",
            "ids": _video_job.get("ids") or [],
            "step": _video_job.get("step") or "",
            "done": _video_job.get("done") or 0,
            "total": _video_job.get("total") or 0,
            "cost": _video_job.get("cost") or 0,
            "url": _video_job.get("url") or "",
            "error": _video_job.get("error") or "",
        }
    if (folder / "video.mp4").is_file():
        return {
            "status": "idle",
            "step": "",
            "done": 0,
            "total": 0,
            "cost": 0,
            "url": f"/api/project/{project_id}/video",
            "error": "",
        }
    return {"status": "idle", "step": "", "done": 0, "total": 0, "cost": 0, "url": "", "error": ""}


@app.get("/api/project/{project_id}/video")
async def project_video(project_id: str):
    path = project_folder(project_id) / "video.mp4"
    if not path.is_file():
        raise HTTPException(404, "No video yet.")
    return FileResponse(
        path,
        media_type="video/mp4",
        filename="omnivid.mp4",
        headers={"Cache-Control": "no-cache"},
    )


if __name__ == "__main__":
    import socket

    import uvicorn

    # Python opens IPv6 sockets as IPv6-only, so one "::" bind drops IPv4.
    # Listen on both families. Localhost stays on the IPv4 socket.
    # 18080 is the same app. Phone networks often answer cleartext :8080
    # with HTTP 408 before the request arrives here. The web board stays on 8080.
    def listener(family: int, host: str, port: int) -> socket.socket:
        sock = socket.socket(family, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if family == socket.AF_INET6:
            sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        sock.bind((host, port))
        sock.listen(2048)
        return sock

    sockets = []
    for port in (8080, 18080):
        sockets.append(listener(socket.AF_INET, "0.0.0.0", port))
        sockets.append(listener(socket.AF_INET6, "::", port))
    server = uvicorn.Server(uvicorn.Config(app))
    server.run(sockets=sockets)
