let lines = [];
let lyricsSource = "";
let lyricsEdited = false;
let editingIndex = null;
let busy = false;

let currentProject = null;
let songName = "";
let songPath = "";
let anchor = null;
let selected = [];
let painting = false;
let sections = [];
let uploads = [];
let stillTarget = null;
let cast = [{ name: "", look: "" }];
let seq = 1;
let openFrame = null;
let lastFrameButton = null;

const lyricsEl = document.getElementById("lyrics");
const selectionBar = document.getElementById("selection-bar");
const feelEl = document.getElementById("feel");
const masterEl = document.getElementById("master-prompt");
const uploadBox = document.getElementById("upload-box");
const songFile = document.getElementById("song-file");
const workCol = document.getElementById("col-work");

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1).padStart(4, "0");
  return m + ":" + s;
}

function setStatus(text) {
  document.getElementById("status").textContent = text || "";
}

function newId() {
  seq += 1;
  return "s" + seq;
}

function selectionPayload() {
  if (!selected.length) return null;
  const picked = selected.map((i) => lines[i]);
  return {
    start: picked[0].start,
    end: picked[picked.length - 1].end,
    lyrics: picked.map((line) => line.text).join(" "),
  };
}

function applySelection(canDrag) {
  const chosen = new Set(selected);
  lyricsEl.querySelectorAll(".lyric-line").forEach((line) => {
    const on = chosen.has(Number(line.dataset.index));
    line.classList.toggle("selected", on);
    line.draggable = Boolean(canDrag && on);
  });
  const payload = selectionPayload();
  if (!payload) {
    selectionBar.hidden = true;
    return;
  }
  selectionBar.hidden = false;
  document.getElementById("selection-label").textContent =
    formatTime(payload.start) + " – " + formatTime(payload.end);
}

function selectRange(from, to) {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  selected = [];
  for (let i = lo; i <= hi; i += 1) selected.push(i);
  applySelection(false);
}

function clearSelection() {
  anchor = null;
  selected = [];
  applySelection(false);
}

function lyricNote() {
  if (!lines.length) return "Load a song, then transcribe.";
  return lines.length + " lines from the song. Double-click a line, or use Edit, to correct the words.";
}

function lyricSpan(text) {
  const span = document.createElement("span");
  span.className = "lyric-text";
  span.textContent = text;
  return span;
}

function replaceWholeLine(haystack, prev, next) {
  if (!prev) return haystack;
  let out = "";
  let rest = haystack;
  while (rest) {
    const at = rest.indexOf(prev);
    if (at < 0) return out + rest;
    const before = at === 0 || rest[at - 1] === " ";
    const afterAt = at + prev.length;
    const after = afterAt === rest.length || rest[afterAt] === " ";
    out += rest.slice(0, at) + (before && after ? next : prev);
    rest = rest.slice(afterAt);
  }
  return out;
}

function renderLyrics() {
  editingIndex = null;
  lyricsEl.replaceChildren();
  lines.forEach((line, index) => {
    const row = document.createElement("div");
    row.className = "lyric-line";
    row.dataset.index = String(index);
    row.title = formatTime(line.start) + " – " + formatTime(line.end);
    const ts = document.createElement("span");
    ts.className = "ts";
    ts.textContent = formatTime(line.start);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "text-btn lyric-edit-btn";
    edit.textContent = "Edit";
    edit.title = "Correct this line";
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      beginLyricEdit(index);
    });
    row.append(ts, lyricSpan(line.text), edit);
    lyricsEl.appendChild(row);
  });
  applySelection(selected.length > 0);
}

function beginLyricEdit(index) {
  if (editingIndex === index) return;
  if (editingIndex !== null) commitLyricEdit();
  const row = lyricsEl.querySelector('.lyric-line[data-index="' + index + '"]');
  if (!row) return;
  const text = row.querySelector(".lyric-text");
  if (!text) return;
  const field = document.createElement("textarea");
  field.className = "lyric-edit";
  field.rows = 2;
  field.value = lines[index].text;
  field.setAttribute("aria-label", "Lyric line");
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commitLyricEdit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelLyricEdit();
    }
  });
  field.addEventListener("blur", () => commitLyricEdit());
  text.replaceWith(field);
  row.draggable = false;
  editingIndex = index;
  field.focus();
  field.select();
}

function cancelLyricEdit() {
  if (editingIndex === null) return;
  const index = editingIndex;
  const field = lyricsEl.querySelector(".lyric-edit");
  editingIndex = null;
  if (!field) return;
  const row = field.closest(".lyric-line");
  field.replaceWith(lyricSpan(lines[index].text));
  if (row) row.draggable = selected.includes(index);
}

function commitLyricEdit() {
  if (editingIndex === null) return;
  const index = editingIndex;
  const field = lyricsEl.querySelector(".lyric-edit");
  editingIndex = null;
  if (!field) return;
  const next = field.value.replace(/\s+/g, " ").trim();
  const prev = lines[index].text;
  const row = field.closest(".lyric-line");
  field.replaceWith(lyricSpan(next || prev));
  if (row) row.draggable = selected.includes(index);
  if (!next || next === prev) return;
  lines[index].text = next;
  lyricsEdited = true;
  let shots = 0;
  sections.forEach((sec) => {
    if (!sec.lyrics || !sec.lyrics.includes(prev)) return;
    const updated = replaceWholeLine(sec.lyrics, prev, next);
    if (updated === sec.lyrics) return;
    sec.lyrics = updated;
    shots += 1;
  });
  document.querySelectorAll(".section-card").forEach((card) => {
    const sec = sections.find((item) => item.id === card.dataset.id);
    const node = card.querySelector(".shot-lyrics");
    if (sec && node) node.textContent = sec.lyrics;
  });
  if (openFrame && openFrame.section) {
    openFrame.lyrics = openFrame.section.lyrics || "";
    const shown = document.getElementById("frame-lyrics");
    if (shown) shown.textContent = openFrame.lyrics;
  }
  persist();
  setStatus(shots
    ? "Lyric updated. Shots that used that line now show the new words."
    : "Lyric updated.");
}

function frameFromSection(sec) {
  return {
    id: sec.id,
    start: sec.start,
    end: sec.end,
    kind: sec.kind || "still",
    prompt: sec.prompt || "",
    lyrics: sec.lyrics || "",
    image: sec.image || "",
    sent: sec.sent || "",
    section: sec,
  };
}

function reelFrames() {
  return sections.map(frameFromSection);
}

function overlaps(section) {
  return sections.some(
    (other) => other.id !== section.id && section.start < other.end && other.start < section.end
  );
}

function renderTimeline() {
  const root = document.getElementById("timeline");
  root.replaceChildren();
  document.getElementById("drop-hint").hidden = sections.length > 0;
  sections.forEach((sec, index) => {
    const card = document.createElement("article");
    card.className = "section-card";
    card.dataset.id = sec.id;

    const head = document.createElement("div");
    head.className = "shot-head";
    const time = document.createElement("strong");
    time.textContent = formatTime(sec.start) + " – " + formatTime(sec.end);
    const meta = document.createElement("span");
    meta.className = "shot-meta";
    const span = sec.end - sec.start;
    meta.textContent = span.toFixed(1) + "s";
    head.append(time, meta);
    if (span > 15) {
      const warn = document.createElement("span");
      warn.className = "warn";
      warn.textContent = "Over 15s";
      head.appendChild(warn);
    }
    if (overlaps(sec)) {
      const warn = document.createElement("span");
      warn.className = "warn";
      warn.textContent = "Overlaps";
      head.appendChild(warn);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-btn";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      sections = sections.filter((item) => item.id !== sec.id);
      renderTimeline();
      persist();
    });
    head.appendChild(remove);

    const lyric = document.createElement("p");
    lyric.className = "shot-lyrics";
    lyric.textContent = sec.lyrics;

    const body = document.createElement("div");
    body.className = "shot-body";
    const side = document.createElement("div");
    side.className = "still-side";
    const still = document.createElement("div");
    still.className = "still";
    if (sec.image) {
      still.classList.add("has-image");
      const thumb = document.createElement("img");
      thumb.src = sec.image;
      thumb.alt = "";
      still.appendChild(thumb);
    } else {
      still.textContent = "Drop still";
    }
    still.tabIndex = 0;
    still.title = "Drop a still here, or open it";
    bindStillTarget(still, sec);
    const openThis = () => openFrameModal(frameFromSection(sec, index), still);
    still.addEventListener("click", openThis);
    still.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openThis();
    });
    const regen = document.createElement("button");
    regen.type = "button";
    regen.textContent = "Regenerate";
    const shotStatus = document.createElement("p");
    shotStatus.className = "shot-status";
    regen.addEventListener("click", () => {
      runGenerate([sec], "Regenerating this image");
    });
    side.append(still, regen);

    const prompt = document.createElement("textarea");
    prompt.rows = 4;
    prompt.placeholder = sec.suggesting
      ? "Suggesting a prompt from these lyrics…"
      : "What this shot should show";
    prompt.value = sec.prompt || "";
    if (sec.suggesting) shotStatus.textContent = "Suggesting a prompt…";
    prompt.addEventListener("input", () => {
      sec.prompt = prompt.value;
      sec.promptEdited = true;
      sec.suggesting = false;
      const popup = document.getElementById("frame-prompt");
      if (openFrame && openFrame.id === sec.id && document.activeElement !== popup) {
        popup.value = prompt.value;
      }
      persist();
    });
    body.append(side, prompt);
    card.append(head, lyric, body, shotStatus);
    root.appendChild(card);
  });
  renderReel();
}

function isStillFile(file) {
  return /^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
}

function stillFiles(event) {
  return [...(event.dataTransfer.files || [])].filter(isStillFile);
}

function dragHasStill(event) {
  const types = [...event.dataTransfer.types];
  return types.includes("application/x-omnivid-still") || types.includes("Files");
}

function bindStillTarget(el, sec) {
  el.addEventListener("dragover", (event) => {
    if (!dragHasStill(event)) return;
    event.preventDefault();
    event.stopPropagation();
    el.classList.add("over");
  });
  el.addEventListener("dragleave", (event) => {
    if (!el.contains(event.relatedTarget)) el.classList.remove("over");
  });
  el.addEventListener("drop", (event) => {
    if (!dragHasStill(event)) return;
    event.preventDefault();
    event.stopPropagation();
    el.classList.remove("over");
    receiveStill(event, sec);
  });
}

function receiveStill(event, sec) {
  const files = [...(event.dataTransfer.files || [])];
  if (files.length) {
    const images = files.filter(isStillFile);
    if (!images.length) {
      setStatus("Use a JPEG, PNG, or WebP.");
      return;
    }
    if (!sec) {
      setStatus("Add a shot before dropping a still on it.");
      return;
    }
    uploadStills(images, sec);
    return;
  }
  if (!sec) {
    setStatus("Add a shot before dropping a still on it.");
    return;
  }
  const id = event.dataTransfer.getData("application/x-omnivid-still");
  const item = uploads.find((other) => other.id === id);
  if (!item) {
    setStatus("Drop the still on the frame it belongs to.");
    return;
  }
  placeStill(sec, item);
}

function placeStill(sec, item) {
  sec.image = item.url;
  sec.source = "upload";
  sec.sent = "";
  uploads = uploads.filter((other) => other.id !== item.id);
  renderTimeline();
  renderStillBin();
  persist();
  setStatus("Placed " + (item.name || "still") + " on " + formatTime(sec.start) + " – " + formatTime(sec.end) + ".");
  const frame = document.querySelector('#reel-scroller .frame[data-id="' + CSS.escape(sec.id) + '"]');
  if (frame) frame.classList.add("flash");
  if (
    openFrame &&
    openFrame.section === sec &&
    document.getElementById("frame-modal").style.display === "flex"
  ) {
    openFrameModal(frameFromSection(sec, sections.indexOf(sec)));
  }
}

async function uploadStills(fileList, targetSec) {
  if (!currentProject) {
    setStatus("Load a song before uploading stills.");
    return;
  }
  const files = [...fileList].filter(isStillFile);
  if (!files.length) {
    setStatus("Use a JPEG, PNG, or WebP.");
    return;
  }
  const body = new FormData();
  files.forEach((file) => body.append("files", file));
  const button = document.getElementById("upload-stills-btn");
  button.disabled = true;
  setStatus("Uploading " + files.length + (files.length === 1 ? " still…" : " stills…"));
  try {
    const res = await fetch("/api/project/" + currentProject + "/stills", { method: "POST", body });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    const saved = data.stills || [];
    if (!saved.length) throw new Error("No stills were saved.");
    if (targetSec && sections.includes(targetSec)) {
      const [first, ...rest] = saved;
      uploads.push(...rest);
      placeStill(targetSec, first);
      if (rest.length) setStatus("Placed the first still. Drag the others onto their frames.");
    } else {
      uploads.push(...saved);
      renderStillBin();
      persist();
      const noun = saved.length === 1 ? "Still ready. Drag it onto a frame." : saved.length + " stills ready. Drag each one onto a frame.";
      setStatus(noun);
    }
  } catch (err) {
    setStatus(err.message || "Could not upload the still.");
  } finally {
    button.disabled = false;
  }
}

function renderStillBin() {
  const bin = document.getElementById("still-bin");
  const scroller = document.getElementById("still-bin-scroller");
  bin.hidden = uploads.length === 0;
  scroller.replaceChildren();
  uploads.forEach((item) => {
    const card = document.createElement("div");
    card.className = "still-chip";
    card.draggable = true;
    card.title = item.name || "Still";
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("application/x-omnivid-still", item.id);
      event.dataTransfer.setData("text/plain", JSON.stringify({ still: item.id }));
      event.dataTransfer.effectAllowed = "copy";
    });
    const img = document.createElement("img");
    img.src = item.url;
    img.alt = "";
    const foot = document.createElement("span");
    foot.className = "frame-time";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = item.name || "Still";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-btn";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => removeUpload(item));
    foot.append(name, remove);
    card.append(img, foot);
    scroller.appendChild(card);
  });
}

async function removeUpload(item) {
  uploads = uploads.filter((other) => other.id !== item.id);
  renderStillBin();
  persist();
  if (!currentProject) return;
  const filename = String(item.url).split("?")[0].split("/").pop();
  await fetch("/api/project/" + currentProject + "/stills/" + encodeURIComponent(filename), { method: "DELETE" });
}

function renderReel() {
  const frames = reelFrames();
  const note = document.getElementById("reel-note");
  note.textContent = sections.length
    ? "Drag one of your stills onto a frame. Generate fills frames that are still empty, at $0.02 each."
    : "Frames show up here after you drop lyrics on the timeline.";
  const scroller = document.getElementById("reel-scroller");
  scroller.replaceChildren();
  frames.forEach((frame) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "frame";
    button.dataset.id = frame.id;
    button.addEventListener("click", () => openFrameModal(frame, button));
    bindStillTarget(button, frame.section || null);
    const poster = document.createElement("span");
    poster.className = "poster";
    if (frame.image) {
      const img = document.createElement("img");
      img.src = frame.image;
      img.alt = "";
      poster.appendChild(img);
    }
    const badge = document.createElement("span");
    badge.className = "kind-badge";
    const yours = frame.section && frame.section.source === "upload";
    badge.textContent = frame.kind === "clip" ? "Clip" : yours ? "Yours" : "Still";
    poster.appendChild(badge);
    const time = document.createElement("span");
    time.className = "frame-time";
    time.textContent = formatTime(frame.start) + " – " + formatTime(frame.end);
    button.append(poster, time);
    scroller.appendChild(button);
  });
  if (openFrame && !frames.some((frame) => frame.id === openFrame.id)) closeFrame();
}

function openFrameModal(frame, button) {
  openFrame = frame.section ? frameFromSection(frame.section, sections.indexOf(frame.section)) : frame;
  lastFrameButton = button || null;
  document.getElementById("frame-title").textContent =
    formatTime(openFrame.start) + " – " + formatTime(openFrame.end);
  const kind = openFrame.kind === "clip" ? "Clip" : "Still";
  const yours = openFrame.section && openFrame.section.source === "upload";
  document.getElementById("frame-meta").textContent = yours
    ? kind + " · your still. Regenerate replaces it at $0.02."
    : kind + (openFrame.image ? "" : " · empty. Drop a still here, or generate.");
  document.getElementById("frame-lyrics").textContent = openFrame.lyrics || "";
  const stage = document.getElementById("frame-stage");
  stage.replaceChildren();
  if (openFrame.image) {
    const img = document.createElement("img");
    img.src = openFrame.image;
    img.alt = "";
    stage.appendChild(img);
  }
  const prompt = document.getElementById("frame-prompt");
  prompt.value = (openFrame.section ? openFrame.section.prompt : openFrame.prompt) || "";
  document.getElementById("frame-sent").textContent = openFrame.sent ? "Sent: " + openFrame.sent : "";
  document.getElementById("frame-status").textContent = "";
  document.getElementById("frame-modal").style.display = "flex";
  prompt.focus();
}

function closeFrame() {
  document.getElementById("frame-modal").style.display = "none";
  openFrame = null;
  if (lastFrameButton && lastFrameButton.isConnected) lastFrameButton.focus();
  lastFrameButton = null;
}

function renderCast() {
  const root = document.getElementById("cast");
  root.replaceChildren();
  cast.forEach((person, index) => {
    const card = document.createElement("div");
    card.className = "character";
    const name = document.createElement("input");
    name.type = "text";
    name.className = "char-name";
    name.placeholder = "Name";
    name.value = person.name;
    name.addEventListener("input", () => {
      cast[index].name = name.value;
      persist();
    });
    const look = document.createElement("textarea");
    look.className = "char-look";
    look.rows = 2;
    look.placeholder = "Look, wardrobe, how far from the camera";
    look.value = person.look;
    look.addEventListener("input", () => {
      cast[index].look = look.value;
      persist();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-btn";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      cast.splice(index, 1);
      renderCast();
      persist();
    });
    card.append(name, look, remove);
    root.appendChild(card);
  });
}

function addSection(payload) {
  const sec = {
    id: newId(),
    start: Number(payload.start),
    end: Number(payload.end),
    lyrics: String(payload.lyrics || ""),
    prompt: "",
    suggesting: true,
    promptEdited: false,
  };
  sections.push(sec);
  sections.sort((a, b) => a.start - b.start || a.end - b.end);
  renderTimeline();
  persist();
  setStatus("Added " + formatTime(sec.start) + " – " + formatTime(sec.end) + ". Suggesting a prompt.");
  suggestPrompt(sec);
}

async function suggestPrompt(sec) {
  try {
    const res = await fetch("/api/suggest-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lyrics: sec.lyrics,
        start: sec.start,
        end: sec.end,
        feel: feelEl.value,
        master_prompt: masterEl.value,
        characters: cast.filter((person) => person.name || person.look),
      }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    const suggestion = String(data.prompt || "").trim();
    if (!suggestion) throw new Error("No prompt came back.");
    if (!sec.promptEdited) sec.prompt = suggestion;
  } catch (err) {
    if (!sec.promptEdited) {
      setStatus(err.message || "Could not suggest a prompt.");
    }
  } finally {
    sec.suggesting = false;
    const field = document.querySelector(
      '.section-card[data-id="' + CSS.escape(sec.id) + '"] textarea'
    );
    if (field) {
      field.placeholder = "What this shot should show";
      if (!sec.promptEdited) field.value = sec.prompt;
    }
    const note = document.querySelector(
      '.section-card[data-id="' + CSS.escape(sec.id) + '"] .shot-status'
    );
    if (note && note.textContent === "Suggesting a prompt…") note.textContent = "";
    const popup = document.getElementById("frame-prompt");
    if (
      openFrame &&
      openFrame.section === sec &&
      document.getElementById("frame-modal").style.display === "flex" &&
      !sec.promptEdited
    ) {
      popup.value = sec.prompt;
    }
    persist();
    if (sec.prompt && !sec.promptEdited) {
      setStatus("Suggested a prompt. Edit it, then generate.");
    } else if (sec.promptEdited) {
      setStatus("Kept what you typed. Generate when it looks right.");
    }
  }
}

function writeDrag(event) {
  const payload = selectionPayload();
  if (!payload) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.setData("text/plain", JSON.stringify(payload));
  event.dataTransfer.effectAllowed = "copy";
}

function readDrag(event) {
  if (event.dataTransfer.files && event.dataTransfer.files.length) return null;
  const raw = event.dataTransfer.getData("text/plain");
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    if (typeof payload.start !== "number" || typeof payload.end !== "number") return null;
    return payload;
  } catch {
    return null;
  }
}

function isAudio(file) {
  return file.type.startsWith("audio/") || /\.(mp3|wav|m4a|flac|ogg|aac)$/i.test(file.name);
}

async function loadSong(file) {
  if (!isAudio(file)) {
    setStatus("Choose an audio file.");
    return;
  }
  songName = file.name;
  document.getElementById("song-label").textContent = file.name;
  document.getElementById("project-title").textContent = file.name;
  setStatus("Loading song…");
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/project", { method: "POST", body });
  if (!res.ok) {
    setStatus("Could not load the song.");
    return;
  }
  const data = await res.json();
  currentProject = data.project_id;
  const timeline = await (await fetch("/api/project/" + currentProject)).json();
  songPath = timeline.song_path || "";
  songName = timeline.song || file.name;
  lines = [];
  lyricsSource = "";
  lyricsEdited = false;
  clearSelection();
  renderLyrics();
  document.getElementById("lyrics-note").textContent = "Song loaded. Transcribe to fill the lyrics.";
  persist();
  setStatus("Song loaded. Transcribe to fill the lyrics.");
}

function boardState() {
  return {
    projectId: currentProject,
    songName,
    songPath,
    feel: feelEl.value,
    master: masterEl.value,
    cast,
    sections,
    uploads,
    seq,
    lyricsSource,
    lyricsEdited,
    lines: lyricsSource === "song" ? lines : [],
  };
}

function persist() {
  sessionStorage.setItem("omnivid-board", JSON.stringify(boardState()));
}

function restore() {
  const raw = sessionStorage.getItem("omnivid-board");
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    currentProject = data.projectId || null;
    songName = data.songName || "";
    songPath = data.songPath || "";
    if (songName) {
      document.getElementById("song-label").textContent = songName;
      document.getElementById("project-title").textContent = songName;
    }
    feelEl.value = data.feel || "";
    masterEl.value = data.master || "";
    if (Array.isArray(data.cast)) cast = data.cast;
    if (Array.isArray(data.sections)) sections = data.sections;
    if (Array.isArray(data.uploads)) {
      uploads = data.uploads.filter((item) => item && item.id && item.url);
    }
    if (data.seq) seq = data.seq;
    if (data.lyricsSource === "song" && Array.isArray(data.lines) && data.lines.length) {
      lines = data.lines;
      lyricsSource = "song";
    }
    document.getElementById("lyrics-note").textContent = lines.length
      ? lyricNote()
      : (songName ? "Song loaded. Transcribe to fill the lyrics." : lyricNote());
  } catch {
    sessionStorage.removeItem("omnivid-board");
  }
}

lyricsEl.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".lyric-edit")) return;
  if (editingIndex !== null) commitLyricEdit();
  if (event.target.closest(".lyric-edit-btn")) return;
  const line = event.target.closest(".lyric-line");
  if (!line) {
    clearSelection();
    return;
  }
  const index = Number(line.dataset.index);
  if (line.classList.contains("selected") && !event.shiftKey) return;
  event.preventDefault();
  painting = true;
  if (event.shiftKey && anchor !== null) selectRange(anchor, index);
  else {
    anchor = index;
    selected = [index];
    applySelection(false);
  }
});

document.addEventListener("pointermove", (event) => {
  if (!painting) return;
  const el = document.elementFromPoint(event.clientX, event.clientY);
  const line = el && el.closest(".lyric-line");
  if (!line || anchor === null) return;
  selectRange(anchor, Number(line.dataset.index));
});

document.addEventListener("pointerup", () => {
  if (!painting) return;
  painting = false;
  applySelection(true);
});

selectionBar.addEventListener("dragstart", writeDrag);
lyricsEl.addEventListener("dblclick", (event) => {
  if (event.target.closest(".lyric-edit, .lyric-edit-btn")) return;
  const line = event.target.closest(".lyric-line");
  if (!line) return;
  beginLyricEdit(Number(line.dataset.index));
});

lyricsEl.addEventListener("dragstart", (event) => {
  if (event.target.closest(".lyric-edit")) {
    event.preventDefault();
    return;
  }
  if (!event.target.closest(".lyric-line.selected")) {
    event.preventDefault();
    return;
  }
  writeDrag(event);
});

workCol.addEventListener("dragover", (event) => {
  if (event.target.closest(".still, .frame")) return;
  const types = [...event.dataTransfer.types];
  if (types.includes("application/x-omnivid-still") || types.includes("Files")) return;
  event.preventDefault();
  workCol.classList.add("over");
});

workCol.addEventListener("dragleave", (event) => {
  if (!workCol.contains(event.relatedTarget)) workCol.classList.remove("over");
});

workCol.addEventListener("drop", (event) => {
  if (event.defaultPrevented) return;
  event.preventDefault();
  workCol.classList.remove("over");
  const types = [...event.dataTransfer.types];
  if (types.includes("application/x-omnivid-still") || stillFiles(event).length) {
    setStatus("Drop the still on the frame it belongs to.");
    return;
  }
  const payload = readDrag(event);
  if (!payload) return;
  addSection(payload);
});

window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());

uploadBox.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  songFile.click();
});

document.getElementById("choose-btn").addEventListener("click", (event) => {
  event.stopPropagation();
  songFile.click();
});

songFile.addEventListener("change", () => {
  const file = songFile.files && songFile.files[0];
  if (file) loadSong(file);
});

uploadBox.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.stopPropagation();
  uploadBox.classList.add("over");
});

uploadBox.addEventListener("dragleave", () => uploadBox.classList.remove("over"));

uploadBox.addEventListener("drop", (event) => {
  event.preventDefault();
  event.stopPropagation();
  uploadBox.classList.remove("over");
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) loadSong(file);
});

async function readError(res) {
  const data = await res.json().catch(() => ({}));
  if (typeof data.detail === "string" && data.detail) return data.detail;
  return "Request failed.";
}

async function generateOne(sec) {
  const res = await fetch(
    "/api/project/" + currentProject + "/sections/" + encodeURIComponent(sec.id) + "/image",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: sec.prompt || "",
        lyrics: sec.lyrics || "",
        start: sec.start,
        end: sec.end,
        feel: feelEl.value,
        master_prompt: masterEl.value,
        characters: cast.filter((person) => person.name || person.look),
      }),
    }
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  sec.image = data.url + "?t=" + Date.now();
  sec.sent = data.prompt || "";
  sec.source = "generated";
  persist();
  return data;
}

async function runGenerate(list, label) {
  if (busy) return;
  if (!currentProject) {
    setStatus("Load a song first. Each image is $0.02.");
    return;
  }
  if (!list.length) {
    setStatus("Nothing to generate.");
    return;
  }
  busy = true;
  document.getElementById("generate-btn").disabled = true;
  document.getElementById("transcribe-btn").disabled = true;
  const reopenId = openFrame && openFrame.section ? openFrame.id : null;
  let spent = 0;
  try {
    for (let i = 0; i < list.length; i += 1) {
      setStatus(label + " " + (i + 1) + " of " + list.length + " · $0.02 each");
      const data = await generateOne(list[i]);
      spent += Number(data.cost) || 0.02;
      renderTimeline();
    }
    const modal = document.getElementById("frame-modal");
    if (reopenId && modal.style.display === "flex") {
      const sec = sections.find((item) => item.id === reopenId);
      if (sec) openFrameModal(frameFromSection(sec, sections.indexOf(sec)));
      document.getElementById("frame-status").textContent = "Image ready. $" + spent.toFixed(2);
    }
    const noun = list.length === 1 ? "image" : "images";
    setStatus("Ready. " + list.length + " " + noun + ", $" + spent.toFixed(2) + ".");
  } catch (err) {
    setStatus(err.message || "Image request failed.");
  } finally {
    busy = false;
    document.getElementById("generate-btn").disabled = false;
    document.getElementById("transcribe-btn").disabled = false;
  }
}

document.getElementById("transcribe-btn").addEventListener("click", async () => {
  if (busy) return;
  if (!currentProject) {
    setStatus("Load a song before transcribing.");
    return;
  }
  busy = true;
  document.getElementById("transcribe-btn").disabled = true;
  setStatus("Transcribing on this machine. A full song can take several minutes.");
  try {
    const res = await fetch("/api/project/" + currentProject + "/transcribe", { method: "POST" });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    const next = (data.lines || [])
      .map((line) => ({
        start: Number(line.start) || 0,
        end: Number(line.end) || 0,
        text: String(line.text || "").trim(),
      }))
      .filter((line) => line.text);
    if (!next.length) throw new Error("Whisper returned no lines.");
    lines = next;
    lyricsSource = "song";
    clearSelection();
    renderLyrics();
    document.getElementById("lyrics-note").textContent = lyricNote();
    persist();
    setStatus("Transcription ready. Highlight lines and drag them onto the timeline.");
  } catch (err) {
    setStatus(err.message || "Transcription failed.");
  } finally {
    busy = false;
    document.getElementById("transcribe-btn").disabled = false;
  }
});

document.getElementById("generate-btn").addEventListener("click", () => {
  if (!currentProject) {
    setStatus("Load a song first. Each image is $0.02.");
    return;
  }
  if (!sections.length) {
    setStatus("Add shots to the timeline first. Each image is $0.02.");
    return;
  }
  const missing = sections.filter((sec) => !sec.image);
  if (!missing.length) {
    setStatus("Every shot already has an image. Regenerate replaces one, at $0.02.");
    return;
  }
  runGenerate(missing, "Generating");
});

document.getElementById("add-character").addEventListener("click", () => {
  cast.push({ name: "", look: "" });
  renderCast();
  persist();
  const fields = document.querySelectorAll(".char-name");
  fields[fields.length - 1].focus();
});

feelEl.addEventListener("input", persist);
masterEl.addEventListener("input", persist);

document.getElementById("save-btn").addEventListener("click", async () => {
  if (!currentProject) {
    setStatus("Load a song before saving. The board stays in this tab.");
    return;
  }
  const existing = await (await fetch("/api/project/" + currentProject)).json();
  const timeline = {
    id: currentProject,
    song: existing.song || songName,
    song_path: existing.song_path || songPath,
    global_style: feelEl.value,
    feel: feelEl.value,
    master_prompt: masterEl.value,
    characters: cast.filter((person) => person.name || person.look),
    lyrics_source: lyricsSource,
    lyrics: lines.map((line) => ({ start: line.start, end: line.end, text: line.text })),
    sections: sections.map((sec) => ({
      id: sec.id,
      start: sec.start,
      end: sec.end,
      lyrics: sec.lyrics,
      prompt: sec.prompt || "",
      image: sec.image ? String(sec.image).split("?")[0] : "",
      sent: sec.sent || "",
      source: sec.source || "",
    })),
    uploads: uploads.map((item) => ({
      id: item.id,
      url: String(item.url).split("?")[0],
      name: item.name || "",
    })),
  };
  const res = await fetch("/api/project/" + currentProject + "/timeline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(timeline),
  });
  setStatus(res.ok ? "Saved." : "Save failed.");
});

document.getElementById("frame-prompt").addEventListener("input", (event) => {
  if (!openFrame) return;
  const value = event.target.value;
  if (openFrame.section) {
    openFrame.section.prompt = value;
    openFrame.section.promptEdited = true;
    openFrame.section.suggesting = false;
    const field = document.querySelector(
      '.section-card[data-id="' + CSS.escape(openFrame.id) + '"] textarea'
    );
    if (field) field.value = value;
  } else {
    openFrame.prompt = value;
  }
  persist();
});

const stillFile = document.getElementById("still-file");
document.getElementById("upload-stills-btn").addEventListener("click", () => {
  stillTarget = null;
  stillFile.value = "";
  stillFile.click();
});
stillFile.addEventListener("change", () => {
  const files = stillFile.files;
  const target = stillTarget;
  stillTarget = null;
  if (files && files.length) uploadStills(files, target);
});

const reel = document.getElementById("reel");
reel.addEventListener("dragover", (event) => {
  if (event.target.closest(".frame")) return;
  if (![...event.dataTransfer.types].includes("Files")) return;
  event.preventDefault();
  event.stopPropagation();
  reel.classList.add("over");
});
reel.addEventListener("dragleave", (event) => {
  if (!reel.contains(event.relatedTarget)) reel.classList.remove("over");
});
reel.addEventListener("drop", (event) => {
  if (event.target.closest(".frame")) return;
  const files = stillFiles(event);
  reel.classList.remove("over");
  if (!files.length) return;
  event.preventDefault();
  event.stopPropagation();
  uploadStills(files, null);
});

document.getElementById("frame-upload").addEventListener("click", () => {
  if (!openFrame || !openFrame.section) {
    document.getElementById("frame-status").textContent =
      "Add this span to the timeline before giving it a still.";
    return;
  }
  stillTarget = openFrame.section;
  stillFile.value = "";
  stillFile.click();
});

document.getElementById("frame-regen").addEventListener("click", () => {
  if (!openFrame || !openFrame.section) {
    document.getElementById("frame-status").textContent =
      "Drop this span on the timeline before generating.";
    return;
  }
  document.getElementById("frame-status").textContent = "Generating… $0.02";
  runGenerate([openFrame.section], "Regenerating");
});

document.getElementById("close-frame").addEventListener("click", closeFrame);

document.getElementById("frame-modal").addEventListener("click", (event) => {
  if (event.target.id === "frame-modal") closeFrame();
});

document.addEventListener("keydown", (event) => {
  const modalOpen = document.getElementById("frame-modal").style.display === "flex";
  if (event.key === "Escape" && modalOpen && !event.target.closest(".lyric-edit")) {
    closeFrame();
    return;
  }
  if (event.key !== "Enter" || event.shiftKey || event.repeat) return;
  if (editingIndex !== null || modalOpen) return;
  if (event.target.closest("input, textarea, button, select")) return;
  if (selected.length !== 1) return;
  event.preventDefault();
  beginLyricEdit(selected[0]);
});

document.getElementById("settings-btn").addEventListener("click", () => {
  document.getElementById("settings-modal").style.display = "flex";
});

document.getElementById("close-settings").addEventListener("click", () => {
  document.getElementById("settings-modal").style.display = "none";
});

document.getElementById("save-key").addEventListener("click", async () => {
  const key = document.getElementById("api-key").value;
  if (!key) {
    setStatus("No API key entered.");
    return;
  }
  const body = new FormData();
  body.append("api_key", key);
  const res = await fetch("/api/settings", { method: "POST", body });
  document.getElementById("settings-modal").style.display = "none";
  document.getElementById("api-key").value = "";
  setStatus(res.ok ? "API key saved on this machine." : "Could not save the API key.");
});

restore();
renderLyrics();
renderTimeline();
renderCast();
renderStillBin();
