let lines = [];
let lyricsSource = "";
let lyricsEdited = false;
let editingIndex = null;
let busy = false;

let currentProject = null;
let projectName = "";
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
let audioJob = false;
let generatedTrack = null;
let videoUrl = "";
let videoQuote = null;
let videoTimer = 0;
let songSeconds = 0;
let estimateTimer = 0;
let estimateToken = 0;
let persistTimer = 0;
let clipDrag = false;

const lyricsEl = document.getElementById("lyrics");
const selectionBar = document.getElementById("selection-bar");
const feelEl = document.getElementById("feel");
const masterEl = document.getElementById("master-prompt");
const uploadBox = document.getElementById("upload-box");
const songFile = document.getElementById("song-file");
const workCol = document.getElementById("col-work");

function projectApi(id, suffix) {
  return "/api/project/" + encodeURIComponent(id) + (suffix || "");
}

function showTitle() {
  document.getElementById("project-title").textContent = projectName || songName || "No project";
}

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
    if (!line.querySelector(".lyric-edit")) line.draggable = true;
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
  if (lyricsSource === "written" && lines.length) {
    return "These are the lyrics used to generate the track. Times are only spread across its length so far. Sync to the song to time them to the singing.";
  }
  if (lyricsSource === "written") return "Instrumental track. No lyrics were written for it.";
  if (!lines.length) return songName ? "Song loaded. Paste or choose the lyrics and sync, or transcribe." : "Load a song, then transcribe.";
  const unsure = lines.filter((line) => line.sure === false).length;
  const check = unsure ? " Lines marked ? may be off; check those." : "";
  return lines.length + " lines, timed to the song." + check + " Double-click a line, or use Edit, to correct the words. Fixes are saved with the song.";
}

function linesFromLyrics(text, duration) {
  const rows = String(text || "").split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  if (!rows.length) return [];
  const total = Math.max(rows.length * 0.1, Number(duration) || 30);
  const slice = total / rows.length;
  return rows.map((line, index) => {
    const start = Math.round(index * slice * 10) / 10;
    const end = index === rows.length - 1
      ? Math.round(total * 10) / 10
      : Math.round((index + 1) * slice * 10) / 10;
    return { start, end: Math.max(end, start + 0.1), text: line };
  });
}

function pastedLyrics() {
  return document.getElementById("lyrics-paste").value.trim();
}

function syncLyricsChrome() {
  const button = document.getElementById("transcribe-btn");
  button.hidden = lyricsSource === "written" && !lines.length;
  button.textContent = pastedLyrics() || lyricsSource === "written" ? "Sync to the song" : "Transcribe";
  document.getElementById("lyrics-note").textContent = lyricNote();
}

let lyricSaveTimer = 0;

function saveLyricsSoon() {
  if (!currentProject || !lines.length) return;
  if (lyricSaveTimer) clearTimeout(lyricSaveTimer);
  lyricSaveTimer = setTimeout(async () => {
    lyricSaveTimer = 0;
    try {
      await fetch(projectApi(currentProject, "/lyrics"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines, source: "edited" }),
      });
    } catch {
      // The board keeps them in this tab; the next edit tries again.
    }
  }, 600);
}

async function loadSavedLyrics() {
  if (!currentProject) return false;
  try {
    const res = await fetch(projectApi(currentProject, "/lyrics"));
    if (!res.ok) return false;
    const data = await res.json();
    const saved = (data.lines || []).filter((line) => line && line.text);
    if (!saved.length) return false;
    lines = saved.map((line) => ({
      start: Number(line.start) || 0,
      end: Number(line.end) || 0,
      text: String(line.text),
      sure: line.sure !== false,
    }));
    lyricsSource = "song";
    return true;
  } catch {
    return false;
  }
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
    row.draggable = true;
    row.dataset.index = String(index);
    row.title = formatTime(line.start) + " – " + formatTime(line.end);
    const ts = document.createElement("span");
    ts.className = "ts";
    ts.textContent = formatTime(line.start);
    ts.title = "Play from this line";
    ts.addEventListener("click", (event) => {
      event.stopPropagation();
      playFrom(lines[index].start);
    });
    const setBtn = document.createElement("button");
    setBtn.type = "button";
    setBtn.className = "text-btn lyric-set";
    setBtn.textContent = "Set";
    setBtn.title = "Press while the song plays: this line starts now";
    setBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setLineStart(index);
    });
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "text-btn lyric-edit-btn";
    edit.textContent = "Edit";
    edit.title = "Correct this line";
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      beginLyricEdit(index);
    });
    row.append(ts, lyricSpan(line.text), setBtn, edit);
    if (lineUsed(line)) row.classList.add("used");
    if (line.sure === false) {
      row.classList.add("unsure");
      row.title += " · timing may be off";
    }
    lyricsEl.appendChild(row);
  });
  applySelection(selected.length > 0);
  playingIndex = -1;
  markPlaying(true);
}

// ---- Song player: hear the song and check each line lands on time ----

const songAudio = document.getElementById("song-audio");
const songSeek = document.getElementById("song-seek");
let playingIndex = -1;
let seeking = false;
let songTick = 0;

function songUrl() {
  return currentProject ? projectApi(currentProject, "/song") + "?p=" + encodeURIComponent(songPath || songName) : "";
}

function syncSongPlayer() {
  const bar = document.getElementById("song-player");
  const url = songName && currentProject ? songUrl() : "";
  bar.hidden = !url;
  if (!url) {
    songAudio.pause();
    songAudio.removeAttribute("src");
    songAudio.load();
    return;
  }
  if (songAudio.dataset.url !== url) {
    songAudio.dataset.url = url;
    songAudio.src = url;
  }
  paintSongClock();
}

function paintSongClock() {
  const now = songAudio.currentTime || 0;
  const total = Number.isFinite(songAudio.duration) ? songAudio.duration : songSeconds;
  document.getElementById("song-clock").textContent = formatTime(now) + " / " + formatTime(total || 0);
  if (!seeking) {
    songSeek.max = String(total || 0);
    songSeek.value = String(now);
  }
  document.getElementById("song-play").textContent = songAudio.paused ? "Play" : "Pause";
}

function currentLineIndex(t) {
  let found = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].start <= t + 0.02) found = i;
    else break;
  }
  if (found >= 0 && t > lines[found].end + 1.5) return -1;
  return found;
}

function markPlaying(force) {
  const t = songAudio.currentTime || 0;
  const index = songAudio.dataset.url && (songAudio.currentTime > 0 || !songAudio.paused) ? currentLineIndex(t) : -1;
  if (index === playingIndex && !force) return;
  playingIndex = index;
  lyricsEl.querySelectorAll(".lyric-line.playing").forEach((row) => row.classList.remove("playing"));
  if (index < 0) return;
  const row = lyricsEl.querySelector('.lyric-line[data-index="' + index + '"]');
  if (!row) return;
  row.classList.add("playing");
  if (!songAudio.paused && editingIndex === null) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function tickSong() {
  paintSongClock();
  markPlaying(false);
  songTick = songAudio.paused ? 0 : requestAnimationFrame(tickSong);
}

function playFrom(seconds) {
  if (!songAudio.dataset.url) {
    setStatus("Load a song first.");
    return;
  }
  // A little lead-in so the line's first word isn't clipped.
  songAudio.currentTime = Math.max(0, Number(seconds) - 0.5);
  songAudio.play().catch(() => setStatus("Could not play the song."));
}

function setLineStart(index) {
  const line = lines[index];
  if (!line) return;
  if (!songAudio.dataset.url || (songAudio.paused && !(songAudio.currentTime > 0))) {
    setStatus("Play the song, then press Set right as this line starts.");
    return;
  }
  const t = Math.round((songAudio.currentTime || 0) * 100) / 100;
  const prev = lines[index - 1];
  const next = lines[index + 1];
  if (prev && t <= prev.start + 0.05) {
    setStatus("That's before the line above starts. Set that line first, or let the song play further.");
    return;
  }
  if (next && t >= next.end - 0.05) {
    setStatus("That's after the next line ends. Set the next line first.");
    return;
  }
  const length = Math.max(0.3, line.end - line.start);
  line.start = t;
  line.end = Math.round(Math.max(t + 0.3, next ? Math.min(t + length, next.start) : t + length) * 100) / 100;
  if (prev && prev.end > t) prev.end = t;
  line.sure = true;
  lyricsEdited = true;
  saveLyricsSoon();
  persist();
  renderLyrics();
  syncLyricsChrome();
  setStatus("Line " + (index + 1) + " now starts at " + formatTime(t) + ". Saved with the song.");
}

songAudio.addEventListener("play", () => {
  if (!songTick) songTick = requestAnimationFrame(tickSong);
});
songAudio.addEventListener("pause", tickSong);
songAudio.addEventListener("ended", tickSong);
songAudio.addEventListener("loadedmetadata", paintSongClock);
songAudio.addEventListener("seeked", () => {
  paintSongClock();
  markPlaying(true);
});
document.getElementById("song-play").addEventListener("click", () => {
  if (songAudio.paused) songAudio.play().catch(() => setStatus("Could not play the song."));
  else songAudio.pause();
});
songSeek.addEventListener("input", () => {
  seeking = true;
  document.getElementById("song-clock").textContent =
    formatTime(Number(songSeek.value)) + " / " + formatTime(Number(songSeek.max) || 0);
});
songSeek.addEventListener("change", () => {
  seeking = false;
  songAudio.currentTime = Number(songSeek.value) || 0;
});

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
  saveLyricsSoon();
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
    if (sec && node) node.textContent = shotWords(sec);
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
    role: sec.role || "",
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

function lineUsed(line) {
  const span = Math.max(0.1, line.end - line.start);
  return sections.some((sec) => {
    if (plainRole(sec.role)) return false;
    const overlap = Math.min(sec.end, line.end) - Math.max(sec.start, line.start);
    return overlap > span * 0.5;
  });
}

function markUsedLines() {
  lyricsEl.querySelectorAll(".lyric-line").forEach((row) => {
    const line = lines[Number(row.dataset.index)];
    row.classList.toggle("used", Boolean(line && lineUsed(line)));
  });
}

function alreadyPlaced(payload) {
  const text = String(payload.lyrics || "").trim();
  return sections.some((sec) => {
    if (plainRole(sec.role)) return false;
    const sameWords = text && String(sec.lyrics || "").trim() === text;
    const covers = sec.start <= Number(payload.start) + 0.05 && sec.end >= Number(payload.end) - 0.05;
    return sameWords && covers;
  });
}

function fittingSpan(start, end) {
  const gaps = [];
  let from = start;
  const blocks = [...sections].sort((a, b) => a.start - b.start || a.end - b.end);
  for (const block of blocks) {
    if (block.end <= from + 0.001 || block.start >= end - 0.001) continue;
    if (block.start > from + 0.001) gaps.push([from, Math.min(block.start, end)]);
    from = Math.max(from, block.end);
    if (from >= end - 0.001) break;
  }
  if (from < end - 0.001) gaps.push([from, end]);
  let best = null;
  for (const gap of gaps) {
    if (gap[1] - gap[0] < 0.2) continue;
    if (!best || gap[1] - gap[0] > best[1] - best[0]) best = gap;
  }
  return best;
}

function plainRole(role) {
  return role === "cover" || role === "credit" || role === "fill";
}

function cardLabel(sec) {
  if (!sec) return "";
  if (sec.role === "cover") return "Cover";
  if (sec.role === "credit") return "End credit";
  if (sec.role === "fill") return "B-roll";
  return "";
}

function shotWords(sec) {
  const words = String((sec && sec.lyrics) || "").trim();
  if (words) return words;
  return cardLabel(sec);
}

function roundTenth(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return Math.round((number + Number.EPSILON) * 10) / 10;
}

function floorTenth(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return Math.floor(number * 10 + 1e-4) / 10;
}

function nextBoundary(sec) {
  let limit = songSeconds > 0 ? songSeconds : Infinity;
  sections.forEach((other) => {
    if (other.id === sec.id) return;
    if (other.start > sec.start + 0.001 && other.start < limit) limit = other.start;
  });
  return limit;
}

function maxDuration(sec) {
  const limit = nextBoundary(sec);
  const current = Math.max(0.2, sec.end - sec.start);
  if (!Number.isFinite(limit)) return Math.max(current, 30);
  const room = limit - sec.start;
  if (room < 0.2) return current;
  return Math.max(0.2, floorTenth(room));
}

function clampDuration(sec, seconds) {
  let value = roundTenth(seconds);
  if (!Number.isFinite(value)) value = roundTenth(sec.end - sec.start);
  if (!Number.isFinite(value) || value < 0.2) value = 0.2;
  const limit = nextBoundary(sec);
  if (Number.isFinite(limit)) {
    const max = floorTenth(limit - sec.start);
    if (max >= 0.2 && value > max) value = max;
  }
  return value;
}

function holdAmount() {
  if (!(songSeconds > 0)) return null;
  let songEnd = songSeconds;
  let covered = 0;
  sections.forEach((sec) => {
    covered += Math.max(0, sec.end - sec.start);
    if (sec.end > songEnd) songEnd = sec.end;
  });
  return Math.round((songEnd - covered) * 100) / 100;
}

function orderedSections() {
  return [...sections].sort((a, b) => a.start - b.start || a.end - b.end);
}

function coveredSeconds() {
  return sections.reduce((sum, sec) => sum + Math.max(0, sec.end - sec.start), 0);
}

function listGaps() {
  const gaps = [];
  let cursor = 0;
  orderedSections().forEach((sec) => {
    if (sec.start > cursor + 0.2) gaps.push({ start: cursor, end: sec.start });
    cursor = Math.max(cursor, sec.end);
  });
  if (songSeconds > cursor + 0.2) gaps.push({ start: cursor, end: songSeconds });
  return gaps;
}

function gapRow(start, end) {
  const row = document.createElement("div");
  row.className = "gap-row";
  const label = document.createElement("span");
  const span = Math.max(0, end - start);
  label.textContent = span.toFixed(1) + "s uncovered · " + formatTime(start) + " – " + formatTime(end);
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Insert card";
  button.addEventListener("click", () => insertGapCard(start, end, "fill"));
  row.append(label, button);
  return row;
}

function refreshGapRows() {
  const root = document.getElementById("timeline");
  if (!root) return;
  root.querySelectorAll(".gap-row").forEach((el) => el.remove());
  let cursor = 0;
  orderedSections().forEach((sec) => {
    if (sec.start > cursor + 0.2) {
      const row = gapRow(cursor, sec.start);
      const card = root.querySelector('.section-card[data-id="' + CSS.escape(sec.id) + '"]');
      if (card) root.insertBefore(row, card);
      else root.appendChild(row);
    }
    cursor = Math.max(cursor, sec.end);
  });
  if (songSeconds > cursor + 0.2) root.appendChild(gapRow(cursor, songSeconds));
}

function renderCoverage() {
  const box = document.getElementById("coverage");
  if (!box) return;
  const known = songSeconds > 0;
  if (!known && !sections.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const covered = coveredSeconds();
  const total = document.getElementById("coverage-total");
  const holdEl = document.getElementById("coverage-hold");
  if (known) {
    total.textContent = "Covered " + covered.toFixed(1) + "s of " + songSeconds.toFixed(1) + "s";
    const hold = holdAmount();
    holdEl.textContent = hold !== null && hold > 0.25
      ? "About " + Math.round(hold).toFixed(0) + "s has no card. The render plays the shot before each gap longer (billed). Fill gaps turns them into B-roll."
      : (sections.length ? "Every second of the song has a card." : "");
  } else {
    total.textContent = "Covered " + covered.toFixed(1) + "s. The song length isn't known yet.";
    holdEl.textContent = "";
  }
  const bar = document.getElementById("coverage-bar");
  bar.replaceChildren();
  const scale = Math.max(known ? songSeconds : 0, ...sections.map((sec) => sec.end), 0);
  if (scale > 0) {
    let cursor = 0;
    const paintGap = (start, end) => {
      if (end - start <= 0.05) return;
      const wide = end - start >= 0.2;
      const piece = document.createElement(wide ? "button" : "div");
      piece.className = "coverage-piece gap";
      piece.style.flexGrow = String(end - start);
      if (wide) {
        piece.type = "button";
        piece.title = "Insert a card in " + (end - start).toFixed(1) + "s at " + formatTime(start);
        piece.addEventListener("click", () => insertGapCard(start, end, "fill"));
      }
      bar.appendChild(piece);
    };
    const paintCard = (start, end) => {
      if (end - start <= 0.05) return;
      const piece = document.createElement("div");
      piece.className = "coverage-piece covered";
      piece.style.flexGrow = String(end - start);
      bar.appendChild(piece);
    };
    orderedSections().forEach((sec) => {
      if (sec.start > cursor + 0.05) paintGap(cursor, sec.start);
      paintCard(sec.start, sec.end);
      cursor = Math.max(cursor, sec.end);
    });
    if (scale > cursor + 0.05) paintGap(cursor, scale);
  }
  refreshGapRows();
}

function renderHold() {
  renderCoverage();
}

function paintWarnings(card, sec) {
  const head = card.querySelector(".shot-head");
  const remove = head.querySelector(".text-btn");
  const span = sec.end - sec.start;
  let over = head.querySelector(".warn-long");
  if (span > 15) {
    if (!over) {
      over = document.createElement("span");
      over.className = "warn warn-long";
      over.textContent = "Over 15s";
      head.insertBefore(over, remove);
    }
  } else if (over) {
    over.remove();
  }
  let overlap = head.querySelector(".warn-over");
  if (overlaps(sec)) {
    if (!overlap) {
      overlap = document.createElement("span");
      overlap.className = "warn warn-over";
      overlap.textContent = "Overlaps";
      head.insertBefore(overlap, remove);
    }
  } else if (overlap) {
    overlap.remove();
  }
}

function paintClip(sec, card) {
  if (!card) card = document.querySelector('.section-card[data-id="' + CSS.escape(sec.id) + '"]');
  if (!card) return;
  const span = sec.end - sec.start;
  const time = card.querySelector(".shot-time");
  if (time) time.textContent = formatTime(sec.start) + " – " + formatTime(sec.end);
  const meta = card.querySelector(".shot-meta");
  if (meta) meta.textContent = span.toFixed(1) + "s";
  const field = card.querySelector(".clip-duration");
  if (field) {
    field.max = String(maxDuration(sec));
    if (document.activeElement !== field) field.value = span.toFixed(1);
  }
  const fill = card.querySelector(".clip-fill");
  if (fill) {
    const max = Math.max(0.2, maxDuration(sec));
    const pct = Math.max(0, Math.min(100, (span / max) * 100));
    fill.style.width = pct + "%";
  }
  paintWarnings(card, sec);
  if (openFrame && openFrame.id === sec.id) {
    openFrame.start = sec.start;
    openFrame.end = sec.end;
    const label = cardLabel(sec);
    document.getElementById("frame-title").textContent =
      (label ? label + " · " : "") + formatTime(sec.start) + " – " + formatTime(sec.end);
  }
  const reelTime = document.querySelector(
    '#reel-scroller .frame[data-id="' + CSS.escape(sec.id) + '"] .frame-time'
  );
  if (reelTime) {
    const label = cardLabel(sec);
    reelTime.textContent = (label ? label + " · " : "") + formatTime(sec.start) + " – " + formatTime(sec.end);
  }
}

function setClipDuration(sec, seconds, live) {
  let next = clampDuration(sec, seconds);
  if (!live) next = roundTenth(next);
  sec.end = Math.round((sec.start + next) * 1000) / 1000;
  if (sec.end <= sec.start) sec.end = Math.round((sec.start + 0.2) * 1000) / 1000;
  paintClip(sec);
  renderHold();
  if (live) {
    persistSoon();
    scheduleEstimate();
    return;
  }
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = 0;
  }
  sections.sort((a, b) => a.start - b.start || a.end - b.end);
  renderTimeline();
  persist();
  scheduleEstimate();
}

function bindDuration(sec, card) {
  const field = card.querySelector(".clip-duration");
  const handle = card.querySelector(".clip-handle");
  const track = card.querySelector(".clip-track");
  field.addEventListener("input", () => {
    setClipDuration(sec, field.value, true);
  });
  field.addEventListener("change", () => {
    setClipDuration(sec, field.value, false);
  });
  field.addEventListener("keydown", (event) => {
    event.stopPropagation();
  });
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    clipDrag = true;
    handle.setPointerCapture(event.pointerId);
    const move = (ev) => {
      const rect = track.getBoundingClientRect();
      const width = rect.width || 1;
      const frac = Math.min(1, Math.max(0, (ev.clientX - rect.left) / width));
      setClipDuration(sec, Math.max(0.2, frac * maxDuration(sec)), true);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      clipDrag = false;
      setClipDuration(sec, sec.end - sec.start, false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
}

function insertGapCard(start, end, role) {
  const kind = plainRole(role) ? role : "fill";
  const name = cardLabel({ role: kind }) || "Card";
  if ((kind === "cover" || kind === "credit") && sections.some((sec) => sec.role === kind)) {
    setStatus(name + " is already on the timeline.");
    return;
  }
  if (!(end - start >= 0.2)) {
    setStatus("That gap is too small for a card.");
    return;
  }
  let id = kind === "fill" ? newId() : kind;
  if (sections.some((sec) => sec.id === id)) id = newId();
  const sec = {
    id,
    role: kind,
    start,
    end,
    lyrics: "",
    prompt: "",
    suggesting: false,
    promptEdited: false,
  };
  sections.push(sec);
  sections.sort((a, b) => a.start - b.start || a.end - b.end);
  renderTimeline();
  persist();
  scheduleEstimate();
  const card = document.querySelector('.section-card[data-id="' + CSS.escape(sec.id) + '"]');
  if (card) {
    card.classList.add("placed");
    card.scrollIntoView({ block: "nearest" });
  }
  setStatus(name + " placed at " + formatTime(start) + " – " + formatTime(end) + ", filling that gap. Shorten it if you want a shorter shot.");
}

function placeEdgeCard(role) {
  const name = cardLabel({ role }) || "Card";
  if (sections.some((sec) => sec.role === role)) {
    setStatus(name + " is already on the timeline.");
    return;
  }
  const gaps = listGaps();
  if (role === "cover") {
    const opening = gaps.find((gap) => gap.start <= 0.05);
    if (!opening) {
      setStatus("The song already starts on a shot.");
      return;
    }
    insertGapCard(opening.start, opening.end, "cover");
    return;
  }
  if (!(songSeconds > 0)) {
    setStatus("The song length isn't known yet.");
    return;
  }
  const tail = [...gaps].reverse().find((gap) => gap.end >= songSeconds - 0.05);
  if (!tail) {
    setStatus("The timeline already reaches the end of the song.");
    return;
  }
  insertGapCard(tail.start, tail.end, "credit");
}

const SHORT_GAP = 2.5;
const BROLL_TARGET = 6;
const BROLL_MIN = 4;
const BROLL_MAX = 8;
let filling = false;
let beatCache = { project: null, data: null };

async function loadBeats() {
  if (beatCache.project === currentProject && beatCache.data) return beatCache.data;
  const empty = { available: false, beats: [], bars: [] };
  try {
    const res = await fetch(projectApi(currentProject, "/beats"));
    if (!res.ok) return empty;
    const data = await res.json();
    beatCache = { project: currentProject, data };
    return data;
  } catch {
    return empty;
  }
}

function nearestTime(list, target, reach) {
  let best = null;
  for (const t of list || []) {
    const off = Math.abs(t - target);
    if (off <= reach && (best === null || off < Math.abs(best - target))) best = t;
  }
  return best;
}

// Split one gap into shots of about 4–8 seconds. Inner cuts move to the
// nearest bar line, or failing that the nearest beat, when one is close.
function planCuts(start, end, beats) {
  const length = end - start;
  let count = Math.max(1, Math.round(length / BROLL_TARGET));
  count = Math.max(count, Math.ceil(length / BROLL_MAX));
  while (count > 1 && length / count < BROLL_MIN) count -= 1;
  const marks = [start];
  for (let k = 1; k < count; k += 1) {
    const ideal = start + (length * k) / count;
    const snapped = nearestTime(beats.bars, ideal, 1.5) ?? nearestTime(beats.beats, ideal, 0.5);
    const prev = marks[marks.length - 1];
    const cut = snapped !== null && snapped - prev >= 2 && end - snapped >= 2 ? snapped : ideal;
    marks.push(Math.round(cut * 100) / 100);
  }
  marks.push(end);
  const cuts = [];
  for (let k = 0; k + 1 < marks.length; k += 1) cuts.push([marks[k], marks[k + 1]]);
  return cuts;
}

function lyricNeighbors(start, end) {
  let before = "";
  let after = "";
  orderedSections().forEach((sec) => {
    const words = String(sec.lyrics || "").trim();
    if (!words) return;
    if (sec.end <= start + 0.05) before = words;
    else if (!after && sec.start >= end - 0.05) after = words;
  });
  return { before, after };
}

// A short gap belongs to the card before it. With no card before it (the
// very start of the song), the card after it starts earlier instead.
function absorbGap(gap) {
  const ordered = orderedSections();
  const prev = [...ordered].reverse().find((sec) => sec.end <= gap.start + 0.05);
  if (prev) {
    prev.end = Math.round(gap.end * 1000) / 1000;
    return true;
  }
  const next = ordered.find((sec) => sec.start >= gap.end - 0.05);
  if (next) {
    next.start = Math.round(gap.start * 1000) / 1000;
    return true;
  }
  return false;
}

async function fillGaps() {
  if (filling || busy) return;
  if (!currentProject) {
    setStatus("Load a song first.");
    return;
  }
  if (!(songSeconds > 0)) {
    setStatus("The song length isn't known yet.");
    return;
  }
  const gaps = listGaps();
  if (!gaps.length) {
    setStatus("Every second of the song already has a card.");
    return;
  }
  filling = true;
  const button = document.getElementById("fill-gaps");
  button.disabled = true;
  setStatus("Finding the beat…");
  try {
    const beats = await loadBeats();
    let stretched = 0;
    const groups = [];
    gaps.forEach((gap) => {
      if (gap.end - gap.start < SHORT_GAP && sections.length) {
        if (absorbGap(gap)) stretched += 1;
        return;
      }
      const group = planCuts(gap.start, gap.end, beats).map(([start, end]) => ({
        id: newId(),
        role: "fill",
        start,
        end,
        lyrics: "",
        prompt: "",
        suggesting: true,
        promptEdited: false,
      }));
      sections.push(...group);
      groups.push(group);
    });
    sections.sort((a, b) => a.start - b.start || a.end - b.end);
    renderTimeline();
    persist();
    scheduleEstimate();
    const made = groups.reduce((sum, group) => sum + group.length, 0);
    const parts = [];
    if (made) parts.push(made + " B-roll " + (made === 1 ? "card" : "cards"));
    if (stretched) parts.push(stretched + " short " + (stretched === 1 ? "gap" : "gaps") + " joined to the shot before");
    const beatNote = beats.available ? " Cuts land on the beat." : (beats.note ? " " + beats.note : "");
    setStatus("Filled: " + parts.join(", ") + "." + beatNote + (made ? " Suggesting prompts…" : ""));
    for (const group of groups) {
      const used = [];
      const around = lyricNeighbors(group[0].start, group[group.length - 1].end);
      for (let i = 0; i < group.length; i += 1) {
        const sec = group[i];
        if (!sections.includes(sec)) continue;
        await suggestPrompt(sec, {
          broll: true,
          before: around.before,
          after: around.after,
          index: i + 1,
          total: group.length,
          avoid: used,
        });
        if (sec.prompt) used.push(sec.prompt);
      }
    }
    if (made) setStatus("B-roll prompts ready. Edit any of them, then Generate images.");
  } finally {
    filling = false;
    button.disabled = false;
  }
}

function renderTimeline() {
  const root = document.getElementById("timeline");
  root.replaceChildren();
  const hint = document.getElementById("drop-hint");
  hint.hidden = false;
  hint.textContent = sections.length
    ? "Drop more lyrics here. Each scene lands at its own time."
    : "Drop a lyric selection here";
  sections.forEach((sec, index) => {
    const card = document.createElement("article");
    card.className = "section-card";
    card.dataset.id = sec.id;

    const head = document.createElement("div");
    head.className = "shot-head";
    const time = document.createElement("strong");
    time.className = "shot-time";
    time.textContent = formatTime(sec.start) + " – " + formatTime(sec.end);
    const meta = document.createElement("span");
    meta.className = "shot-meta";
    const span = sec.end - sec.start;
    meta.textContent = span.toFixed(1) + "s";
    head.append(time, meta);
    if (span > 15) {
      const warn = document.createElement("span");
      warn.className = "warn warn-long";
      warn.textContent = "Over 15s";
      head.appendChild(warn);
    }
    if (overlaps(sec)) {
      const warn = document.createElement("span");
      warn.className = "warn warn-over";
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
      scheduleEstimate();
    });
    head.appendChild(remove);

    const clipRow = document.createElement("div");
    clipRow.className = "clip-row";
    const track = document.createElement("div");
    track.className = "clip-track";
    const fill = document.createElement("div");
    fill.className = "clip-fill";
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "clip-handle";
    handle.setAttribute("aria-label", "Drag to change duration");
    fill.appendChild(handle);
    track.appendChild(fill);
    const length = document.createElement("label");
    length.className = "clip-length";
    const field = document.createElement("input");
    field.type = "number";
    field.className = "clip-duration";
    field.min = "0.2";
    field.step = "0.1";
    field.setAttribute("aria-label", "Duration in seconds");
    const unit = document.createElement("span");
    unit.textContent = "s";
    length.append(field, unit);
    clipRow.append(track, length);

    const lyric = document.createElement("p");
    lyric.className = "shot-lyrics";
    const label = cardLabel(sec);
    if (!String(sec.lyrics || "").trim() && label) lyric.classList.add("card-name");
    lyric.textContent = shotWords(sec);

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
      : (label ? "Optional prompt for this card" : "What this shot should show");
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
    card.append(head, clipRow, lyric, body, shotStatus);
    bindDuration(sec, card);
    root.appendChild(card);
    paintClip(sec, card);
  });
  markUsedLines();
  renderReel();
  renderHold();
  scheduleClipStatus();
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
    const res = await fetch(projectApi(currentProject, "/stills"), { method: "POST", body });
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
  await fetch(projectApi(currentProject, "/stills/" + encodeURIComponent(filename)), { method: "DELETE" });
}

function renderReel() {
  const frames = reelFrames();
  const note = document.getElementById("reel-note");
  note.textContent = sections.length
    ? clipNote()
    : "Frames show up here after you drop lyrics on the timeline.";
  const scroller = document.getElementById("reel-scroller");
  scroller.replaceChildren();
  frames.forEach((frame) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "frame";
    button.dataset.id = frame.id;
    button.addEventListener("click", () => openClipModal(frame.section, button));
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
    const state = clipState(frame.id);
    badge.className = "kind-badge state-" + state;
    badge.textContent = CLIP_BADGE[state] || "No clip";
    poster.appendChild(badge);
    const time = document.createElement("span");
    time.className = "frame-time";
    const label = frame.section ? cardLabel(frame.section) : cardLabel(frame);
    const row = clipInfo[frame.id];
    const from = row ? row.start : frame.start;
    const to = row ? row.end : frame.end;
    time.textContent = (label ? label + " · " : "") + formatTime(from) + " – " + formatTime(to);
    button.append(poster, time);
    scroller.appendChild(button);
  });
  if (openFrame && !frames.some((frame) => frame.id === openFrame.id)) closeFrame();
  if (openClip && !sections.includes(openClip)) closeClip();
}

// ---- Reference images: stills are edits of these, so shots stay consistent ----

let refs = [];
let refDefault = "";
let refBusy = false;

function applyRefs(data) {
  refs = Array.isArray(data && data.references) ? data.references : [];
  refDefault = (data && data.default) || "";
  renderRefs();
  fillFrameRef();
}

async function loadRefs() {
  if (!currentProject) {
    applyRefs(null);
    return;
  }
  try {
    const res = await fetch(projectApi(currentProject, "/references"));
    if (res.ok) applyRefs(await res.json());
  } catch {
    // Keep what is shown.
  }
}

function refName(id) {
  const item = refs.find((ref) => ref.id === id);
  return item ? item.name : "";
}

function renderRefs() {
  const root = document.getElementById("ref-list");
  root.replaceChildren();
  if (!refs.length) {
    const empty = document.createElement("p");
    empty.className = "note";
    empty.textContent = currentProject
      ? "No reference yet. Without one, every still is drawn from scratch, and places and people can change between shots."
      : "Create a project or load a song first.";
    root.appendChild(empty);
    return;
  }
  refs.forEach((ref) => {
    const item = document.createElement("div");
    item.className = "ref-item" + (ref.id === refDefault ? " default" : "");
    const img = document.createElement("img");
    img.src = ref.image + "?t=" + ref.id;
    img.alt = "";
    img.title = "Click to view full size";
    img.tabIndex = 0;
    img.addEventListener("click", () => openRefView(ref.id));
    img.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openRefView(ref.id);
    });
    const side = document.createElement("div");
    const name = document.createElement("div");
    name.className = "ref-name";
    name.textContent = ref.name;
    const actions = document.createElement("div");
    actions.className = "ref-actions";
    if (ref.id === refDefault) {
      const tag = document.createElement("span");
      tag.className = "ref-tag";
      tag.textContent = "Default";
      actions.appendChild(tag);
    } else {
      const make = document.createElement("button");
      make.type = "button";
      make.className = "text-btn";
      make.textContent = "Make default";
      make.addEventListener("click", () => refRequest("/references/" + ref.id, { default: true }, ref.name + " is now the default reference."));
      actions.appendChild(make);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-btn";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      if (!window.confirm("Remove the reference \"" + ref.name + "\"? Stills already made stay as they are.")) return;
      try {
        const res = await fetch(projectApi(currentProject, "/references/" + ref.id), { method: "DELETE" });
        if (!res.ok) throw new Error(await readError(res));
        sections.forEach((sec) => { if (sec.reference === ref.id) sec.reference = ""; });
        persist();
        applyRefs(await res.json());
        setStatus("Reference removed.");
      } catch (err) {
        setStatus(err.message || "Could not remove the reference.");
      }
    });
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "text-btn";
    rename.textContent = "Rename";
    rename.addEventListener("click", () => renameRef(ref.id));
    actions.appendChild(rename);
    actions.appendChild(remove);
    side.append(name, actions);
    item.append(img, side);
    root.appendChild(item);
  });
}

let viewingRef = "";

async function renameRef(id) {
  const current = refName(id);
  const next = window.prompt("Rename this reference", current);
  if (next === null) return;
  const name = next.replace(/\s+/g, " ").trim();
  if (!name || name === current) return;
  await refRequest("/references/" + id, { name }, "Renamed to " + name + ".");
  if (viewingRef === id) openRefView(id);
}

function openRefView(id) {
  const ref = refs.find((item) => item.id === id);
  if (!ref) return;
  viewingRef = id;
  document.getElementById("ref-view-title").textContent = ref.name;
  document.getElementById("ref-view-img").src = ref.image + "?t=" + ref.id;
  const using = sections.filter((sec) => (sec.reference || "") === id || (!sec.reference && id === refDefault)).length;
  document.getElementById("ref-view-meta").textContent = (id === refDefault ? "Default reference. " : "") +
    using + (using === 1 ? " card follows" : " cards follow") + " this reference.";
  const make = document.getElementById("ref-view-default");
  make.hidden = id === refDefault;
  document.getElementById("ref-view-status").textContent = "";
  document.getElementById("ref-modal").style.display = "flex";
}

let refEditing = false;

document.getElementById("ref-edit-btn").addEventListener("click", async () => {
  if (refEditing || !viewingRef || !currentProject) return;
  const field = document.getElementById("ref-edit-prompt");
  const wanted = field.value.trim();
  const note = document.getElementById("ref-view-status");
  if (!wanted) {
    note.textContent = "Say what to change first.";
    return;
  }
  refEditing = true;
  const button = document.getElementById("ref-edit-btn");
  button.disabled = true;
  note.textContent = "Editing… about $0.02";
  try {
    const res = await fetch(projectApi(currentProject, "/references/" + viewingRef + "/edit"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: wanted }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    applyRefs(data);
    field.value = "";
    if (data.new_id) openRefView(data.new_id);
    document.getElementById("ref-view-status").textContent =
      "Here's the edited version, saved as a new reference. Make it the default if it's right, or edit it again.";
  } catch (err) {
    note.textContent = err.message || "Could not edit the reference.";
  } finally {
    refEditing = false;
    button.disabled = false;
  }
});

document.getElementById("ref-view-rename").addEventListener("click", () => {
  if (viewingRef) renameRef(viewingRef);
});

document.getElementById("ref-view-remove").addEventListener("click", async () => {
  if (!viewingRef || !currentProject) return;
  const id = viewingRef;
  if (!window.confirm("Remove the reference \"" + refName(id) + "\"? Stills already made stay as they are.")) return;
  try {
    const res = await fetch(projectApi(currentProject, "/references/" + id), { method: "DELETE" });
    if (!res.ok) throw new Error(await readError(res));
    sections.forEach((sec) => { if (sec.reference === id) sec.reference = ""; });
    persist();
    applyRefs(await res.json());
    closeRefView();
    setStatus("Reference removed.");
  } catch (err) {
    document.getElementById("ref-view-status").textContent = err.message || "Could not remove the reference.";
  }
});

function closeRefView() {
  document.getElementById("ref-modal").style.display = "none";
  viewingRef = "";
}

document.getElementById("close-ref").addEventListener("click", closeRefView);
document.getElementById("ref-modal").addEventListener("click", (event) => {
  if (event.target.id === "ref-modal") closeRefView();
});
document.getElementById("ref-view-default").addEventListener("click", async () => {
  if (!viewingRef) return;
  const id = viewingRef;
  await refRequest("/references/" + id, { default: true }, refName(id) + " is now the default reference.");
  openRefView(id);
  document.getElementById("ref-view-status").textContent = "This is now the default. New stills follow it.";
});

async function refRequest(path, body, done) {
  if (!currentProject) {
    setStatus("Create a project or load a song first.");
    return;
  }
  try {
    const res = await fetch(projectApi(currentProject, path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) throw new Error(await readError(res));
    applyRefs(await res.json());
    if (done) setStatus(done);
  } catch (err) {
    setStatus(err.message || "Could not update the reference.");
  }
}

function fillFrameRef() {
  const select = document.getElementById("frame-ref");
  if (!select) return;
  select.replaceChildren();
  const add = (value, label) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  };
  add("", refDefault ? "Default: " + refName(refDefault) : "Default (no reference yet)");
  refs.forEach((ref) => add(ref.id, ref.name));
  add("none", "None: draw from scratch");
  const sec = openFrame && openFrame.section;
  const pick = sec ? sec.reference || "" : "";
  select.value = pick === "none" || refs.some((ref) => ref.id === pick) ? pick : "";
  select.disabled = !sec;
}

document.getElementById("frame-ref").addEventListener("change", (event) => {
  if (!openFrame || !openFrame.section) return;
  openFrame.section.reference = event.target.value;
  persist();
  setStatus("This shot will follow " + (event.target.value === "none"
    ? "no reference"
    : (refName(event.target.value || refDefault) || "the default reference")) + " next time it's generated.");
});

document.getElementById("frame-make-ref").addEventListener("click", async () => {
  if (!openFrame || !openFrame.section || !openFrame.section.image) {
    document.getElementById("frame-status").textContent = "This shot has no still yet.";
    return;
  }
  const sec = openFrame.section;
  const name = window.prompt("Name this reference", cardLabel(sec) || "Shot " + formatTime(sec.start));
  if (name === null) return;
  await refRequest("/references/from-still", {
    image: String(sec.image).split("?")[0],
    name,
  }, "Saved this still as a reference.");
  document.getElementById("frame-status").textContent = "Saved as a reference.";
});

document.getElementById("ref-generate").addEventListener("click", async () => {
  if (refBusy) return;
  if (!currentProject) {
    setStatus("Create a project or load a song first.");
    return;
  }
  refBusy = true;
  const button = document.getElementById("ref-generate");
  button.disabled = true;
  setStatus("Generating a reference image… $0.02");
  try {
    const res = await fetch(projectApi(currentProject, "/references/generate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.getElementById("ref-name").value,
        prompt: document.getElementById("ref-prompt").value,
        feel: feelEl.value,
        master_prompt: masterEl.value,
      }),
    });
    if (!res.ok) throw new Error(await readError(res));
    applyRefs(await res.json());
    document.getElementById("ref-name").value = "";
    setStatus("Reference ready. If it isn't right, remove it and generate again. Stills follow the default.");
  } catch (err) {
    setStatus(err.message || "Could not generate the reference.");
  } finally {
    refBusy = false;
    button.disabled = false;
  }
});

const refFile = document.getElementById("ref-file");
document.getElementById("ref-upload").addEventListener("click", () => {
  refFile.value = "";
  refFile.click();
});
refFile.addEventListener("change", async () => {
  const file = refFile.files && refFile.files[0];
  if (!file || !currentProject) return;
  const body = new FormData();
  body.append("file", file);
  body.append("name", document.getElementById("ref-name").value);
  setStatus("Uploading the reference…");
  try {
    const res = await fetch(projectApi(currentProject, "/references/upload"), { method: "POST", body });
    if (!res.ok) throw new Error(await readError(res));
    applyRefs(await res.json());
    document.getElementById("ref-name").value = "";
    setStatus("Reference added.");
  } catch (err) {
    setStatus(err.message || "Could not upload the reference.");
  }
});

// ---- Fix this shot: talk to Grok about one still, then apply its rewrite ----

let fixBusy = false;

function refLabel(pick) {
  if (pick === "none") return "None: draw from scratch";
  if (!pick) return refDefault ? "Default (" + refName(refDefault) + ")" : "Default";
  return refName(pick) || "Default";
}

function fixText(label, text) {
  const wrap = document.createDocumentFragment();
  const head = document.createElement("span");
  head.className = "fix-label";
  head.textContent = label;
  const body = document.createElement("span");
  body.className = "fix-text";
  body.textContent = text;
  wrap.append(head, body);
  return wrap;
}

function renderFixLog() {
  const log = document.getElementById("fix-log");
  log.replaceChildren();
  const sec = openFrame && openFrame.section;
  if (!sec) return;
  (sec.fixChat || []).forEach((turn, index) => {
    const msg = document.createElement("div");
    if (turn.role === "user") {
      msg.className = "fix-msg you";
      msg.textContent = turn.content;
      log.appendChild(msg);
      return;
    }
    msg.className = "fix-msg grok";
    const reply = document.createElement("span");
    reply.className = "fix-text";
    reply.textContent = turn.reply || "";
    msg.appendChild(reply);
    const plan = turn.proposal;
    if (plan && plan.prompt) {
      msg.appendChild(fixText("New prompt", plan.prompt));
      msg.appendChild(fixText("Reference", refLabel(plan.reference || "")));
      if (plan.motion) msg.appendChild(fixText("Motion", plan.motion));
      const actions = document.createElement("div");
      actions.className = "fix-actions";
      const apply = document.createElement("button");
      apply.type = "button";
      apply.textContent = "Apply";
      apply.addEventListener("click", () => applyFix(sec, plan, false));
      const regen = document.createElement("button");
      regen.type = "button";
      regen.textContent = "Apply and regenerate";
      regen.addEventListener("click", () => applyFix(sec, plan, true));
      actions.append(apply, regen);
      if (index !== sec.fixChat.length - 1) {
        apply.textContent = "Use this one";
        regen.remove();
      }
      msg.appendChild(actions);
    }
    log.appendChild(msg);
  });
  log.scrollTop = log.scrollHeight;
}

function applyFix(sec, plan, regenerate) {
  sec.prompt = plan.prompt;
  sec.promptEdited = true;
  sec.suggesting = false;
  sec.reference = plan.reference || "";
  if (plan.motion) sec.motion = plan.motion;
  const popup = document.getElementById("frame-prompt");
  if (openFrame && openFrame.section === sec) popup.value = sec.prompt;
  const field = document.querySelector('.section-card[data-id="' + CSS.escape(sec.id) + '"] textarea');
  if (field) field.value = sec.prompt;
  fillFrameRef();
  persist();
  scheduleClipStatus();
  if (regenerate) {
    document.getElementById("frame-status").textContent = "Generating… about $0.02";
    runGenerate([sec], "Regenerating");
  } else {
    document.getElementById("frame-status").textContent = "Applied. Regenerate when you're ready.";
  }
}

async function sendFix() {
  if (fixBusy || !openFrame || !openFrame.section || !currentProject) return;
  const sec = openFrame.section;
  const input = document.getElementById("fix-input");
  const message = input.value.trim();
  if (!message) return;
  const look = document.getElementById("fix-look").checked && Boolean(sec.image);
  const history = (sec.fixChat || []).map((turn) => (turn.role === "user"
    ? { role: "user", content: turn.content }
    : { role: "assistant", content: JSON.stringify(Object.assign({ reply: turn.reply }, turn.proposal || {})) }));
  sec.fixChat = (sec.fixChat || []).concat([{ role: "user", content: message }]);
  input.value = "";
  renderFixLog();
  fixBusy = true;
  const button = document.getElementById("fix-send");
  button.disabled = true;
  button.textContent = look ? "Looking…" : "Thinking…";
  try {
    const res = await fetch(projectApi(currentProject, "/sections/" + encodeURIComponent(sec.id) + "/fix"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history,
        prompt: sec.prompt || "",
        motion: sec.motion || "",
        reference: sec.reference || "",
        lyrics: sec.lyrics || "",
        image: sec.image ? String(sec.image).split("?")[0] : "",
        look,
        feel: feelEl.value,
        master_prompt: masterEl.value,
        characters: cast.filter((person) => person.name || person.look),
      }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    sec.fixChat.push({
      role: "assistant",
      reply: data.reply || "",
      proposal: data.prompt ? { prompt: data.prompt, reference: data.reference || "", motion: data.motion || "" } : null,
    });
  } catch (err) {
    sec.fixChat.push({ role: "assistant", reply: err.message || "Could not reach Grok.", proposal: null });
  } finally {
    fixBusy = false;
    button.disabled = false;
    button.textContent = "Ask";
    persist();
    if (openFrame && openFrame.section === sec) renderFixLog();
  }
}

document.getElementById("fix-send").addEventListener("click", sendFix);
document.getElementById("fix-input").addEventListener("keydown", (event) => {
  if (event.key !== "Escape") event.stopPropagation();
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendFix();
  }
});

// ---- Clips: one per shot, watched and remade from the Frames reel ----

const CLIP_BADGE = {
  made: "Clip",
  stale: "Old clip",
  missing: "No clip",
  "no-still": "No still",
};
let clipInfo = {};
let clipSummary = null;
let clipTimer = 0;
let clipToken = 0;
let openClip = null;
let lastClipButton = null;
let clipJobTimer = 0;

function clipState(id) {
  const row = clipInfo[id];
  if (row) return row.state;
  const sec = sections.find((item) => item.id === id);
  return sec && sec.image ? "missing" : "no-still";
}

function clipNote() {
  const base = "Click a frame to watch its clip, change how it moves, or make it again.";
  if (!clipSummary) return base;
  if (!clipSummary.missing) return base + " Every frame with a still has a clip.";
  const noun = clipSummary.missing === 1 ? "frame needs" : "frames need";
  return base + " " + clipSummary.missing + " " + noun + " a clip, about $" +
    Number(clipSummary.missing_cost).toFixed(2) + " with Make clips.";
}

function scheduleClipStatus() {
  if (clipTimer) clearTimeout(clipTimer);
  clipTimer = setTimeout(() => {
    clipTimer = 0;
    refreshClipStatus();
  }, 400);
}

async function refreshClipStatus() {
  if (!currentProject || !sections.length) {
    clipInfo = {};
    clipSummary = null;
    renderReel();
    return;
  }
  const token = ++clipToken;
  try {
    const res = await fetch(projectApi(currentProject, "/clips/status"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(videoBody()),
    });
    if (token !== clipToken) return;
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    clipInfo = {};
    (data.clips || []).forEach((row) => { clipInfo[row.id] = row; });
    clipSummary = data;
  } catch {
    if (token !== clipToken) return;
    clipInfo = {};
    clipSummary = null;
  }
  renderReel();
  if (openClip) paintClipModal(false);
}

function playPieces(urls) {
  const player = document.getElementById("clip-player");
  const still = document.getElementById("clip-still");
  player.pause();
  player.onended = null;
  if (!urls.length) {
    player.removeAttribute("src");
    player.load();
    player.hidden = true;
    const image = openClip && openClip.image ? openClip.image : "";
    still.hidden = !image;
    if (image) still.src = image;
    return;
  }
  still.hidden = true;
  player.hidden = false;
  let index = 0;
  // A shot longer than 15 seconds is several pieces. Play them back to back.
  player.onended = () => {
    index += 1;
    if (index >= urls.length) return;
    player.src = urls[index];
    player.play().catch(() => {});
  };
  player.src = urls[0];
  player.play().catch(() => {});
}

function paintClipModal(reload) {
  if (!openClip) return;
  const sec = openClip;
  const row = clipInfo[sec.id];
  const state = clipState(sec.id);
  const label = cardLabel(sec);
  const from = row ? row.start : sec.start;
  const to = row ? row.end : sec.end;
  document.getElementById("clip-title").textContent =
    (label ? label + " · " : "") + formatTime(from) + " – " + formatTime(to);
  const seconds = row ? row.seconds : 0;
  const meta = {
    made: "Clip made. " + seconds + "s.",
    stale: "This clip is from an older prompt or length. Generate video would make it again.",
    missing: "No clip yet." + (seconds ? " It will run " + seconds + "s." : ""),
    "no-still": "Give this shot a still first. The clip starts from it.",
  };
  document.getElementById("clip-meta").textContent = meta[state] || "";
  document.getElementById("clip-lyrics").textContent = shotWords(sec);
  const motion = document.getElementById("clip-motion");
  if (document.activeElement !== motion) motion.value = sec.motion || "";
  motion.placeholder = sec.prompt
    ? "Following the still: " + sec.prompt
    : "How this clip moves. Leave blank to follow the still's prompt.";
  const make = document.getElementById("clip-make");
  if (state === "no-still" || !row) {
    make.textContent = "Make clip";
    make.disabled = state === "no-still" || busy;
  } else if (state === "made") {
    make.textContent = "Regenerate for $" + Number(row.redo_cost).toFixed(2);
    make.disabled = busy;
  } else {
    make.textContent = "Make clip for $" + Number(row.cost).toFixed(2);
    make.disabled = busy;
  }
  if (reload) playPieces(row ? row.urls || [] : []);
}

function openClipModal(sec, button) {
  if (!sec) return;
  openClip = sec;
  lastClipButton = button || null;
  document.getElementById("clip-status").textContent = "";
  document.getElementById("clip-modal").style.display = "flex";
  paintClipModal(true);
  refreshClipStatus();
}

function closeClip() {
  const player = document.getElementById("clip-player");
  player.pause();
  player.onended = null;
  document.getElementById("clip-modal").style.display = "none";
  openClip = null;
  if (lastClipButton && lastClipButton.isConnected) lastClipButton.focus();
  lastClipButton = null;
}

async function startClips(ids, redo, cost) {
  const res = await fetch(projectApi(currentProject, "/clips/make"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ confirm: true, cost, ids, redo }, videoBody())),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  if (data.status === "running") {
    beginClipWait(data.step);
  } else {
    setStatus(data.step || "Done.");
    refreshClipStatus();
  }
}

function beginClipWait(step) {
  setVideoBusy(true);
  setStatus(step || "Making clips.");
  if (openClip) {
    document.getElementById("clip-status").textContent = step || "Making the clip.";
    paintClipModal(false);
  }
  if (clipJobTimer) clearTimeout(clipJobTimer);
  clipJobTimer = setTimeout(pollClipJob, 1500);
}

async function pollClipJob() {
  clipJobTimer = 0;
  if (!currentProject) return;
  try {
    const res = await fetch(projectApi(currentProject, "/video/status"));
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    const note = document.getElementById("clip-status");
    if (data.status === "running") {
      setStatus(data.step || "Making clips.");
      if (openClip) note.textContent = data.step || "";
      clipJobTimer = setTimeout(pollClipJob, 2000);
      return;
    }
    setVideoBusy(false);
    const text = data.status === "error" ? (data.error || "Clip failed.") : (data.step || "Clip ready.");
    setStatus(text);
    if (openClip) note.textContent = text;
    await refreshClipStatus();
    if (openClip && data.status !== "error") paintClipModal(true);
  } catch (err) {
    setVideoBusy(false);
    setStatus(err.message || "Could not check the clip.");
  }
}

function openFrameModal(frame, button) {
  openFrame = frame.section ? frameFromSection(frame.section, sections.indexOf(frame.section)) : frame;
  lastFrameButton = button || null;
  const frameLabel = cardLabel(openFrame.section || openFrame);
  document.getElementById("frame-title").textContent =
    (frameLabel ? frameLabel + " · " : "") + formatTime(openFrame.start) + " – " + formatTime(openFrame.end);
  const kind = openFrame.kind === "clip" ? "Clip" : "Still";
  const yours = openFrame.section && openFrame.section.source === "upload";
  const lead = frameLabel ? frameLabel + ". " : "";
  document.getElementById("frame-meta").textContent = yours
    ? lead + kind + " · your still. Regenerate replaces it at $0.02."
    : lead + kind + (openFrame.image ? "" : " · empty. Drop a still here, or generate.");
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
  document.getElementById("frame-sent").textContent = openFrame.sent || "";
  document.querySelector(".frame-sent-box").hidden = !openFrame.sent;
  fillFrameRef();
  renderFixLog();
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
  if (alreadyPlaced(payload)) {
    setStatus("That scene is already on the timeline.");
    return;
  }
  const fit = fittingSpan(Number(payload.start), Number(payload.end));
  if (!fit) {
    setStatus("That moment is already a shot.");
    return;
  }
  const clipped = fit[0] > Number(payload.start) + 0.05 || fit[1] < Number(payload.end) - 0.05;
  const sec = {
    id: newId(),
    start: fit[0],
    end: fit[1],
    lyrics: String(payload.lyrics || ""),
    prompt: "",
    suggesting: true,
    promptEdited: false,
  };
  sections.push(sec);
  sections.sort((a, b) => a.start - b.start || a.end - b.end);
  renderTimeline();
  persist();
  const card = document.querySelector('.section-card[data-id="' + CSS.escape(sec.id) + '"]');
  if (card) {
    card.classList.add("placed");
    card.scrollIntoView({ block: "nearest" });
  }
  const when = formatTime(sec.start) + " – " + formatTime(sec.end);
  setStatus(clipped
    ? "Placed at " + when + ", where the timeline had room. Suggesting a prompt."
    : "Placed at " + when + ". Suggesting a prompt.");
  suggestPrompt(sec);
}

async function suggestPrompt(sec, extra) {
  try {
    const res = await fetch("/api/suggest-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(extra || {}),
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

function linePayload(index) {
  const line = lines[index];
  if (!line) return null;
  return { start: line.start, end: line.end, lyrics: line.text };
}

function writeDrag(event) {
  const line = event.target.closest && event.target.closest(".lyric-line");
  let payload = null;
  if (line) {
    const index = Number(line.dataset.index);
    payload = selected.includes(index) ? selectionPayload() : linePayload(index);
  } else {
    payload = selectionPayload();
  }
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

async function loadSong(file, written) {
  if (!isAudio(file)) {
    setStatus("Choose an audio file.");
    return false;
  }
  songName = file.name;
  document.getElementById("song-label").textContent = file.name;
  showTitle();
  setStatus("Loading song…");
  const body = new FormData();
  body.append("file", file);
  const named = Boolean(projectName && currentProject);
  const res = await fetch(named ? projectApi(currentProject, "/song") : "/api/project", { method: "POST", body });
  if (!res.ok) {
    setStatus(await readError(res));
    return false;
  }
  const data = await res.json();
  if (!named) currentProject = data.project_id;
  showVideo("");
  videoQuote = null;
  stopVideoPoll();
  document.getElementById("video-confirm").hidden = true;
  document.getElementById("video-note").textContent = "";
  const timeline = await (await fetch(projectApi(currentProject))).json();
  songPath = timeline.song_path || "";
  songName = timeline.song || file.name;
  songSeconds = Number(timeline.duration) > 0 ? Number(timeline.duration) : 0;
  document.getElementById("song-label").textContent = songName;
  showTitle();
  lyricsEdited = false;
  clearSelection();
  const saved = await loadSavedLyrics();
  if (saved) {
    // This song was timed before, in this project or another one.
  } else if (written) {
    lines = linesFromLyrics(written.lyrics, written.duration);
    lyricsSource = "written";
  } else {
    lines = [];
    lyricsSource = "";
  }
  renderLyrics();
  syncLyricsChrome();
  syncSongPlayer();
  loadRefs();
  renderTimeline();
  persist();
  if (saved) {
    setStatus("Song loaded with the lyrics you saved for it. No transcribing needed.");
  } else {
    setStatus(written
      ? (lines.length
        ? "Track loaded. Sync to the song to time your lyrics to the singing."
        : "Track loaded. No lyrics were written for it.")
      : "Song loaded. Paste or choose the lyrics and sync, or transcribe.");
  }
  return true;
}

function boardState() {
  return {
    projectId: currentProject,
    projectName,
    songName,
    songPath,
    songSeconds,
    feel: feelEl.value,
    master: masterEl.value,
    cast,
    sections,
    uploads,
    seq,
    lyricsSource,
    lyricsEdited,
    lines: lyricsSource === "song" || lyricsSource === "written" ? lines : [],
    sourceTab: document.getElementById("pane-generate").hidden ? "transcribe" : "generate",
    genStyle: document.getElementById("gen-style").value,
    genLyrics: document.getElementById("gen-lyrics").value,
    genLength: document.getElementById("gen-length").value,
    genFit: fitLyrics,
    generatedTrack,
    videoUrl,
  };
}

function persist() {
  sessionStorage.setItem("omnivid-board", JSON.stringify(boardState()));
}

function persistSoon() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = 0;
    persist();
  }, 200);
}

async function refreshSongLength() {
  if (!currentProject) return;
  try {
    const res = await fetch(projectApi(currentProject));
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.duration !== "number") return;
    const probed = data.duration > 0 ? data.duration : 0;
    if (probed === songSeconds) {
      renderHold();
      return;
    }
    songSeconds = probed;
    if (!clipDrag) renderTimeline();
    else renderHold();
    persist();
  } catch {
    renderHold();
  }
}

function restore() {
  const raw = sessionStorage.getItem("omnivid-board");
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    currentProject = data.projectId || null;
    projectName = data.projectName || "";
    songName = data.songName || "";
    songPath = data.songPath || "";
    songSeconds = Number(data.songSeconds) > 0 ? Number(data.songSeconds) : 0;
    if (songName) document.getElementById("song-label").textContent = songName;
    showTitle();
    feelEl.value = data.feel || "";
    masterEl.value = data.master || "";
    if (Array.isArray(data.cast)) cast = data.cast;
    if (Array.isArray(data.sections)) sections = data.sections;
    if (Array.isArray(data.uploads)) {
      uploads = data.uploads.filter((item) => item && item.id && item.url);
    }
    if (data.seq) seq = data.seq;
    if (data.lyricsSource === "written" || (data.lyricsSource === "song" && Array.isArray(data.lines) && data.lines.length)) {
      if (Array.isArray(data.lines)) lines = data.lines;
      lyricsSource = data.lyricsSource;
    }
    syncLyricsChrome();
    if (typeof data.genStyle === "string") document.getElementById("gen-style").value = data.genStyle;
    if (typeof data.genLyrics === "string") document.getElementById("gen-lyrics").value = data.genLyrics;
    if (data.genLength) document.getElementById("gen-length").value = String(data.genLength);
    const restoredLyrics = document.getElementById("gen-lyrics").value.trim().length > 0;
    if (typeof data.genFit === "boolean") {
      fitLyrics = data.genFit && restoredLyrics;
      fitPinnedOff = restoredLyrics && !data.genFit;
    } else if (restoredLyrics) {
      fitLyrics = true;
      fitPinnedOff = false;
    }
    refreshFitControls();
    if (data.generatedTrack && data.generatedTrack.url && data.generatedTrack.name) {
      showGenerated(data.generatedTrack);
    }
    if (typeof data.videoUrl === "string") videoUrl = data.videoUrl;
    if (data.sourceTab === "generate") showSourceTab("generate", true);
  } catch {
    sessionStorage.removeItem("omnivid-board");
  }
}

function showSourceTab(name, quiet) {
  const generate = name === "generate";
  document.getElementById("pane-transcribe").hidden = generate;
  document.getElementById("pane-generate").hidden = !generate;
  const transcribeTab = document.getElementById("tab-transcribe");
  const generateTab = document.getElementById("tab-generate");
  transcribeTab.classList.toggle("on", !generate);
  generateTab.classList.toggle("on", generate);
  transcribeTab.setAttribute("aria-selected", String(!generate));
  generateTab.setAttribute("aria-selected", String(generate));
  if (!quiet) persist();
}

function clock(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
}

function showGenerated(track) {
  generatedTrack = track && track.url && track.name
    ? {
      url: track.url,
      name: track.name,
      lyrics: track.lyrics || "",
      duration: Number(track.duration) || 0,
    }
    : null;
  const bar = document.getElementById("gen-player");
  const audio = document.getElementById("gen-audio");
  const play = document.getElementById("gen-play");
  if (!generatedTrack) {
    bar.hidden = true;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    play.textContent = "Play";
    document.getElementById("gen-time").textContent = "0:00";
    return;
  }
  if (audio.getAttribute("src") !== generatedTrack.url) {
    audio.src = generatedTrack.url;
  }
  bar.hidden = false;
  updateGenTime();
}

function updateGenTime() {
  const audio = document.getElementById("gen-audio");
  const total = Number.isFinite(audio.duration) ? " / " + clock(audio.duration) : "";
  document.getElementById("gen-time").textContent = clock(audio.currentTime) + total;
  document.getElementById("gen-play").textContent = audio.paused ? "Play" : "Pause";
}

lyricsEl.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".lyric-edit")) return;
  if (editingIndex !== null) commitLyricEdit();
  if (event.target.closest(".lyric-edit-btn, .lyric-set, .ts")) return;
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
  if (event.target.closest(".lyric-edit, .lyric-edit-btn")) {
    event.preventDefault();
    return;
  }
  if (!event.target.closest(".lyric-line")) {
    event.preventDefault();
    return;
  }
  writeDrag(event);
});

workCol.addEventListener("dragover", (event) => {
  const types = [...event.dataTransfer.types];
  const stillDrag = types.includes("application/x-omnivid-still") || types.includes("Files");
  if (stillDrag) {
    if (event.target.closest(".still, .frame")) return;
    return;
  }
  event.preventDefault();
  if (!event.target.closest(".still, .frame")) workCol.classList.add("over");
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
    projectApi(currentProject, "/sections/" + encodeURIComponent(sec.id) + "/image"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: sec.prompt || "",
        lyrics: sec.lyrics || "",
        start: sec.start,
        end: sec.end,
        role: plainRole(sec.role) ? sec.role : "",
        reference: sec.reference || "",
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
  document.getElementById("video-btn").disabled = true;
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
    document.getElementById("video-btn").disabled = false;
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
  document.getElementById("video-btn").disabled = true;
  // Pasted lyrics win. A generated track syncs the lyrics it was made from.
  let sheet = pastedLyrics();
  if (!sheet && lyricsSource === "written") sheet = lines.map((line) => line.text).join("\n");
  if (!sheet && lyricsSource === "song" && lines.length &&
      !window.confirm("Replace these lyrics, and any fixes you made, with a fresh transcription?")) {
    busy = false;
    document.getElementById("transcribe-btn").disabled = false;
    document.getElementById("video-btn").disabled = false;
    setStatus("Kept your lyrics.");
    return;
  }
  setStatus(sheet
    ? "Timing your lyrics to the song. The first time takes a few minutes; after that it's instant."
    : "Transcribing on this machine. The first time takes a few minutes; after that it's instant.");
  try {
    const res = await fetch(projectApi(currentProject, "/transcribe"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lyrics: sheet }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    const next = (data.lines || [])
      .map((line) => ({
        start: Number(line.start) || 0,
        end: Number(line.end) || 0,
        text: String(line.text || "").trim(),
        sure: line.sure !== false,
      }))
      .filter((line) => line.text);
    if (!next.length) throw new Error("Whisper returned no lines.");
    lines = next;
    lyricsSource = "song";
    clearSelection();
    renderLyrics();
    syncLyricsChrome();
    persist();
    const unsure = Number(data.unsure) || 0;
    const check = unsure ? " " + unsure + (unsure === 1 ? " line is" : " lines are") + " marked ? and may be off." : "";
    if (data.source === "lrc") setStatus("Lyrics loaded with the times from your .lrc file.");
    else if (data.source === "aligned") setStatus("Your lyrics are timed to the song." + check + " Drag lines onto the timeline.");
    else setStatus("Transcription ready. Fix any words once; they're saved with the song.");
  } catch (err) {
    setStatus(err.message || "Transcription failed.");
  } finally {
    busy = false;
    document.getElementById("transcribe-btn").disabled = false;
    document.getElementById("video-btn").disabled = false;
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

function resetBoard(name, id) {
  projectName = name;
  currentProject = id;
  songName = "";
  songPath = "";
  songSeconds = 0;
  lines = [];
  lyricsSource = "";
  lyricsEdited = false;
  editingIndex = null;
  selected = [];
  anchor = null;
  sections = [];
  uploads = [];
  cast = [{ name: "", look: "" }];
  seq = 1;
  feelEl.value = "";
  masterEl.value = "";
  videoUrl = "";
  videoQuote = null;
  busy = false;
  stopVideoPoll();
  showVideo("");
  document.getElementById("video-confirm").hidden = true;
  document.getElementById("video-note").textContent = "";
  document.getElementById("video-estimate").textContent = "";
  document.getElementById("video-go").textContent = "Generate";
  document.getElementById("video-btn").disabled = false;
  document.getElementById("video-go").disabled = false;
  document.getElementById("generate-btn").disabled = false;
  document.getElementById("transcribe-btn").disabled = false;
  document.getElementById("song-label").textContent = "Drop a song here, or choose a file";
  closeFrame();
  showTitle();
  renderLyrics();
  syncLyricsChrome();
  renderTimeline();
  renderCast();
  renderStillBin();
  showSourceTab("transcribe", true);
  syncSongPlayer();
  loadRefs();
  persist();
}

function openProjectModal() {
  const field = document.getElementById("project-name");
  document.getElementById("project-modal").style.display = "flex";
  field.value = "";
  field.focus();
}

function closeProjectModal() {
  document.getElementById("project-modal").style.display = "none";
}

let creatingProject = false;

async function createNamedProject() {
  if (creatingProject) return;
  const field = document.getElementById("project-name");
  const name = field.value.replace(/\s+/g, " ").trim();
  if (!name) {
    setStatus("Type a project name.");
    field.focus();
    return;
  }
  creatingProject = true;
  const button = document.getElementById("create-project");
  button.disabled = true;
  try {
    const res = await fetch("/api/project/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    resetBoard(data.name, data.project_id);
    closeProjectModal();
    setStatus(
      "Project \"" + data.name + "\" is ready. Stills save in ~/OmniVideo/Projects/" + data.name + "."
    );
  } catch (err) {
    setStatus(err.message || "Could not create the project.");
  } finally {
    creatingProject = false;
    button.disabled = false;
  }
}

document.getElementById("new-project-btn").addEventListener("click", openProjectModal);
document.getElementById("close-project").addEventListener("click", closeProjectModal);
document.getElementById("create-project").addEventListener("click", createNamedProject);
document.getElementById("project-modal").addEventListener("click", (event) => {
  if (event.target.id === "project-modal") closeProjectModal();
});

document.getElementById("save-btn").addEventListener("click", async () => {
  if (!currentProject) {
    setStatus("Create a project, or load a song, before saving.");
    return;
  }
  const existing = await (await fetch(projectApi(currentProject))).json();
  const timeline = {
    id: currentProject,
    name: projectName || existing.name || "",
    song: existing.song || songName,
    song_path: existing.song_path || songPath,
    global_style: feelEl.value,
    feel: feelEl.value,
    master_prompt: masterEl.value,
    characters: cast.filter((person) => person.name || person.look),
    lyrics_source: lyricsSource,
    lyrics: lines.map((line) => ({ start: line.start, end: line.end, text: line.text })),
    sections: sections.map((sec) => {
      const row = {
        id: sec.id,
        start: sec.start,
        end: sec.end,
        lyrics: sec.lyrics,
        prompt: sec.prompt || "",
        image: sec.image ? String(sec.image).split("?")[0] : "",
        sent: sec.sent || "",
        source: sec.source || "",
      };
      if (sec.reference) row.reference = sec.reference;
      if (sec.motion) row.motion = sec.motion;
      if (plainRole(sec.role)) row.role = sec.role;
      return row;
    }),
    video: videoUrl,
    uploads: uploads.map((item) => ({
      id: item.id,
      url: String(item.url).split("?")[0],
      name: item.name || "",
    })),
  };
  const res = await fetch(projectApi(currentProject, "/timeline"), {
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
  if (event.key === "Escape" && document.getElementById("ref-modal").style.display === "flex") {
    if (event.target.id === "ref-edit-prompt") event.target.blur();
    closeRefView();
    return;
  }
  if (event.key === "Escape" && document.getElementById("clip-modal").style.display === "flex") {
    closeClip();
    return;
  }
  const projectOpen = document.getElementById("project-modal").style.display === "flex";
  if (projectOpen && event.key === "Escape") {
    closeProjectModal();
    return;
  }
  if (projectOpen && event.key === "Enter" && event.target.id === "project-name" && !event.repeat) {
    event.preventDefault();
    createNamedProject();
    return;
  }
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

document.getElementById("tab-transcribe").addEventListener("click", () => showSourceTab("transcribe"));
const lyricsFile = document.getElementById("lyrics-file");
document.getElementById("lyrics-file-btn").addEventListener("click", () => {
  lyricsFile.value = "";
  lyricsFile.click();
});
lyricsFile.addEventListener("change", async () => {
  const file = lyricsFile.files && lyricsFile.files[0];
  if (!file) return;
  if (file.size > 200000) {
    setStatus("That file is too big for lyrics.");
    return;
  }
  document.getElementById("lyrics-paste").value = await file.text();
  document.getElementById("lyrics-input").open = true;
  syncLyricsChrome();
  setStatus(/\.lrc$/i.test(file.name)
    ? "Lyrics file loaded. Its own times will be used. Press Sync to the song."
    : "Lyrics file loaded. Press Sync to the song to time them.");
});
document.getElementById("lyrics-paste").addEventListener("input", syncLyricsChrome);
document.getElementById("lyrics-clear").addEventListener("click", () => {
  document.getElementById("lyrics-paste").value = "";
  syncLyricsChrome();
});
document.getElementById("tab-generate").addEventListener("click", () => showSourceTab("generate"));

let fitLyrics = false;
let fitPinnedOff = false;

function lyricsPresent() {
  return document.getElementById("gen-lyrics").value.trim().length > 0;
}

function refreshFitControls() {
  const has = lyricsPresent();
  const box = document.getElementById("gen-fit");
  const select = document.getElementById("gen-length");
  box.checked = Boolean(fitLyrics && has);
  box.disabled = !has;
  select.disabled = box.checked;
}

function syncFitFromLyrics() {
  const has = lyricsPresent();
  if (!has) {
    fitLyrics = false;
    fitPinnedOff = false;
  } else if (!fitPinnedOff) {
    fitLyrics = true;
  }
  refreshFitControls();
}

document.getElementById("gen-style").addEventListener("input", persist);
document.getElementById("gen-style").addEventListener("change", persist);
document.getElementById("gen-lyrics").addEventListener("input", () => {
  syncFitFromLyrics();
  persist();
});
document.getElementById("gen-length").addEventListener("change", () => {
  if (lyricsPresent()) {
    fitLyrics = false;
    fitPinnedOff = true;
    refreshFitControls();
  }
  persist();
});
document.getElementById("gen-fit").addEventListener("change", () => {
  const has = lyricsPresent();
  fitLyrics = document.getElementById("gen-fit").checked && has;
  fitPinnedOff = has && !fitLyrics;
  refreshFitControls();
  persist();
});

async function requestAudio(style, lyrics, duration) {
  const res = await fetch("/api/generate-audio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: style, lyrics, duration }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail;
    const needed = detail && typeof detail === "object" ? Number(detail.needed) : NaN;
    if (res.status === 409 && needed === -1) {
      const message = detail.message || "These lyrics won't fit in that length. Fit the song to the lyrics?";
      if (!window.confirm(message)) throw new Error(message);
      fitLyrics = true;
      fitPinnedOff = false;
      refreshFitControls();
      persist();
      return requestAudio(style, lyrics, -1);
    }
    const message = typeof detail === "string" && detail
      ? detail
      : (detail && typeof detail.message === "string" && detail.message) || "Request failed.";
    throw new Error(message);
  }
  return data;
}

document.getElementById("gen-audio-btn").addEventListener("click", async () => {
  if (audioJob) return;
  const style = document.getElementById("gen-style").value.trim();
  if (style.length < 2) {
    setStatus("Write a style or mood first.");
    return;
  }
  const lyrics = document.getElementById("gen-lyrics").value.trim();
  const fit = fitLyrics && lyrics.length > 0;
  const duration = fit ? -1 : (Number(document.getElementById("gen-length").value) || 30);
  audioJob = true;
  document.getElementById("gen-audio-btn").disabled = true;
  document.getElementById("suggest-lyrics-btn").disabled = true;
  document.getElementById("gen-fit").disabled = true;
  document.getElementById("gen-length").disabled = true;
  setStatus("Generating audio on TEC. This can take a few minutes.");
  try {
    const data = await requestAudio(style, lyrics, duration);
    const reported = Number(data.duration);
    showGenerated({
      url: data.url,
      name: data.name,
      lyrics: typeof data.lyrics === "string" ? data.lyrics : lyrics,
      duration: reported > 0 ? reported : (fit ? 0 : duration),
    });
    persist();
    setStatus(data.status || "Track ready. Play it, or use it as the song.");
  } catch (err) {
    setStatus(err.message || "Audio generation failed.");
  } finally {
    audioJob = false;
    document.getElementById("gen-audio-btn").disabled = false;
    document.getElementById("suggest-lyrics-btn").disabled = false;
    refreshFitControls();
  }
});

document.getElementById("suggest-lyrics-btn").addEventListener("click", async () => {
  if (audioJob) return;
  const style = document.getElementById("gen-style").value.trim();
  if (style.length < 2) {
    setStatus("Write a style or mood first.");
    return;
  }
  const button = document.getElementById("suggest-lyrics-btn");
  button.disabled = true;
  setStatus("Suggesting lyrics…");
  try {
    const res = await fetch("/api/suggest-lyrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: style }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    document.getElementById("gen-lyrics").value = data.lyrics || "";
    syncFitFromLyrics();
    persist();
    setStatus("Lyrics suggested. Edit them, then generate.");
  } catch (err) {
    setStatus(err.message || "Could not suggest lyrics.");
  } finally {
    button.disabled = false;
  }
});

const genAudio = document.getElementById("gen-audio");
document.getElementById("gen-play").addEventListener("click", () => {
  if (!generatedTrack) return;
  if (genAudio.paused) genAudio.play().catch(() => setStatus("Could not play that track."));
  else genAudio.pause();
});
genAudio.addEventListener("timeupdate", updateGenTime);
genAudio.addEventListener("loadedmetadata", updateGenTime);
genAudio.addEventListener("play", updateGenTime);
genAudio.addEventListener("pause", updateGenTime);
genAudio.addEventListener("ended", updateGenTime);

document.getElementById("gen-use").addEventListener("click", async () => {
  if (audioJob) return;
  if (!generatedTrack || !generatedTrack.url) {
    setStatus("Generate a track first.");
    return;
  }
  const button = document.getElementById("gen-use");
  button.disabled = true;
  setStatus("Loading the generated track…");
  try {
    const res = await fetch(generatedTrack.url);
    if (!res.ok) throw new Error("The generated file is missing.");
    const blob = await res.blob();
    const name = generatedTrack.name || "generated.mp3";
    const type = blob.type || (name.endsWith(".wav") ? "audio/wav" : "audio/mpeg");
    const file = new File([blob], name, { type });
    const loaded = await loadSong(file, {
      lyrics: generatedTrack.lyrics || "",
      duration: generatedTrack.duration || genAudio.duration || 0,
    });
    if (loaded) showSourceTab("transcribe");
  } catch (err) {
    setStatus(err.message || "Could not use this track.");
  } finally {
    button.disabled = false;
  }
});

function stopVideoPoll() {
  if (videoTimer) clearTimeout(videoTimer);
  videoTimer = 0;
}

function showVideo(url, fresh) {
  const player = document.getElementById("video-player");
  if (!url) {
    player.pause();
    player.hidden = true;
    player.removeAttribute("src");
    player.load();
    videoUrl = "";
    return;
  }
  const bare = String(url).split("?")[0];
  if (!fresh && videoUrl === bare && player.getAttribute("src")) {
    player.hidden = false;
    return;
  }
  player.src = bare + "?t=" + Date.now();
  player.hidden = false;
  videoUrl = bare;
}

function videoBody() {
  return {
    feel: feelEl.value,
    master_prompt: masterEl.value,
    characters: cast.filter((person) => person.name || person.look),
    sections: sections.map((sec) => {
      const row = {
        id: sec.id,
        start: sec.start,
        end: sec.end,
        lyrics: sec.lyrics || "",
        prompt: sec.prompt || "",
        image: sec.image ? String(sec.image).split("?")[0] : "",
      };
      if (sec.motion) row.motion = sec.motion;
      if (plainRole(sec.role)) row.role = sec.role;
      return row;
    }),
  };
}

function hideVideoQuote() {
  videoQuote = null;
  document.getElementById("video-confirm").hidden = true;
}

function scheduleEstimate() {
  const panel = document.getElementById("video-confirm");
  if (!panel || panel.hidden || busy || !currentProject) return;
  if (estimateTimer) clearTimeout(estimateTimer);
  estimateTimer = setTimeout(() => {
    estimateTimer = 0;
    refreshEstimate();
  }, 300);
}

async function refreshEstimate() {
  if (!currentProject || document.getElementById("video-confirm").hidden || busy) return;
  const token = ++estimateToken;
  try {
    const res = await fetch(projectApi(currentProject, "/video/estimate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(videoBody()),
    });
    if (token !== estimateToken || document.getElementById("video-confirm").hidden) return;
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    if (!(songSeconds > 0) && Number(data.song_seconds) > 0) songSeconds = Number(data.song_seconds);
    videoQuote = data;
    document.getElementById("video-estimate").textContent = data.note || "";
    document.getElementById("video-go").textContent = data.cost > 0
      ? "Generate for $" + Number(data.cost).toFixed(2)
      : "Assemble video";
    renderHold();
  } catch (err) {
    if (token !== estimateToken) return;
    videoQuote = null;
    document.getElementById("video-estimate").textContent = err.message || "Could not estimate the video.";
    document.getElementById("video-go").textContent = "Generate";
  }
}

function setVideoBusy(locked) {
  busy = locked;
  document.getElementById("make-clips-btn").disabled = locked;
  document.getElementById("clip-make").disabled = locked;
  document.getElementById("video-btn").disabled = locked;
  document.getElementById("video-go").disabled = locked;
  document.getElementById("generate-btn").disabled = locked;
  document.getElementById("transcribe-btn").disabled = locked;
}

async function pollVideo() {
  if (!currentProject) return;
  const project = currentProject;
  try {
    const res = await fetch(projectApi(project, "/video/status"));
    if (!res.ok) throw new Error(await readError(res));
    if (currentProject !== project) return;
    const data = await res.json();
    if (data.status === "running") {
      const note = data.step || "Generating the video.";
      document.getElementById("video-note").textContent = note;
      setStatus(note);
      videoTimer = setTimeout(pollVideo, 2000);
      return;
    }
    setVideoBusy(false);
    scheduleClipStatus();
    if (data.status === "done" && data.url) {
      showVideo(data.url, true);
      document.getElementById("video-note").textContent = data.step || "Video ready.";
      setStatus(data.step || "Video ready.");
      persist();
      return;
    }
    if (data.status === "error") {
      document.getElementById("video-note").textContent = data.error || "Video failed.";
      setStatus(data.error || "Video failed.");
      return;
    }
    if (data.url) showVideo(data.url);
    else if (videoUrl) showVideo(videoUrl);
  } catch (err) {
    setVideoBusy(false);
    setStatus(err.message || "Could not check the video.");
  }
}

function beginVideoWait(data) {
  hideVideoQuote();
  setVideoBusy(true);
  document.getElementById("video-note").textContent = (data && data.step) || "Starting the video.";
  setStatus(document.getElementById("video-note").textContent);
  stopVideoPoll();
  videoTimer = setTimeout(pollVideo, 1500);
}

async function resumeVideo() {
  if (!currentProject) {
    if (videoUrl) showVideo(videoUrl);
    return;
  }
  try {
    const res = await fetch(projectApi(currentProject, "/video/status"));
    if (!res.ok) {
      if (videoUrl) showVideo(videoUrl);
      return;
    }
    const data = await res.json();
    if (data.status === "running") {
      if (data.kind === "clips") beginClipWait(data.step);
      else beginVideoWait(data);
      return;
    }
    if (data.status === "error" && data.error) {
      document.getElementById("video-note").textContent = data.error;
    }
    if (data.url) showVideo(data.url);
    else if (videoUrl) showVideo(videoUrl);
  } catch {
    if (videoUrl) showVideo(videoUrl);
  }
}

document.getElementById("video-btn").addEventListener("click", async () => {
  if (busy) return;
  if (!currentProject) {
    setStatus("Load a song first.");
    return;
  }
  if (!sections.length) {
    setStatus("Add shots and images first.");
    return;
  }
  const missing = sections.filter((sec) => !sec.image).length;
  if (missing) {
    const noun = missing === 1 ? "is" : "are";
    setStatus("Every shot needs an image first. " + missing + " " + noun + " still empty.");
    return;
  }
  hideVideoQuote();
  document.getElementById("video-btn").disabled = true;
  document.getElementById("video-note").textContent = "Estimating the cost…";
  setStatus("Estimating the cost…");
  try {
    const res = await fetch(projectApi(currentProject, "/video/estimate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(videoBody()),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    videoQuote = data;
    document.getElementById("video-estimate").textContent = data.note || "";
    document.getElementById("video-go").textContent = data.cost > 0
      ? "Generate for $" + Number(data.cost).toFixed(2)
      : "Assemble video";
    document.getElementById("video-confirm").hidden = false;
    document.getElementById("video-note").textContent = "";
    setStatus("Check the cost, then confirm.");
  } catch (err) {
    document.getElementById("video-note").textContent = err.message || "Could not estimate the video.";
    setStatus(err.message || "Could not estimate the video.");
  } finally {
    document.getElementById("video-btn").disabled = false;
  }
});

document.getElementById("video-cancel").addEventListener("click", () => {
  hideVideoQuote();
  document.getElementById("video-note").textContent = "";
  setStatus("Cancelled. Nothing was generated.");
});

document.getElementById("video-go").addEventListener("click", async () => {
  if (busy || !videoQuote || !currentProject) return;
  const quote = videoQuote;
  const project = currentProject;
  setVideoBusy(true);
  hideVideoQuote();
  document.getElementById("video-note").textContent = "Starting the video.";
  setStatus("Starting the video.");
  try {
    const res = await fetch(projectApi(project, "/video"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ confirm: true, cost: quote.cost }, videoBody())),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    beginVideoWait(data);
  } catch (err) {
    setVideoBusy(false);
    document.getElementById("video-note").textContent = err.message || "Video failed.";
    setStatus(err.message || "Video failed.");
  }
});

document.getElementById("video-player").addEventListener("error", () => {
  const player = document.getElementById("video-player");
  if (!player.getAttribute("src")) return;
  document.getElementById("video-note").textContent = "The video file is missing.";
});

document.getElementById("add-cover").addEventListener("click", () => placeEdgeCard("cover"));
document.getElementById("add-credit").addEventListener("click", () => placeEdgeCard("credit"));
document.getElementById("fill-gaps").addEventListener("click", fillGaps);

document.getElementById("close-clip").addEventListener("click", closeClip);
document.getElementById("clip-modal").addEventListener("click", (event) => {
  if (event.target.id === "clip-modal") closeClip();
});
document.getElementById("clip-motion").addEventListener("input", (event) => {
  if (!openClip) return;
  openClip.motion = event.target.value;
  persist();
  scheduleClipStatus();
});
document.getElementById("clip-still-btn").addEventListener("click", () => {
  if (!openClip) return;
  const sec = openClip;
  closeClip();
  openFrameModal(frameFromSection(sec, sections.indexOf(sec)));
});
document.getElementById("clip-make").addEventListener("click", async () => {
  if (busy || !openClip || !currentProject) return;
  const sec = openClip;
  document.getElementById("clip-status").textContent = "Checking the cost…";
  if (clipTimer) {
    clearTimeout(clipTimer);
    clipTimer = 0;
  }
  await refreshClipStatus();
  const row = clipInfo[sec.id];
  if (!row || row.state === "no-still") {
    document.getElementById("clip-status").textContent = "Give this shot a still first.";
    return;
  }
  const redo = row.state === "made";
  const cost = redo ? row.redo_cost : row.cost;
  document.getElementById("clip-status").textContent = "Starting… $" + Number(cost).toFixed(2);
  try {
    await startClips([sec.id], redo, cost);
  } catch (err) {
    setVideoBusy(false);
    document.getElementById("clip-status").textContent = err.message || "Clip failed.";
    refreshClipStatus();
  }
});
document.getElementById("make-clips-btn").addEventListener("click", async () => {
  if (busy) return;
  if (!currentProject || !sections.length) {
    setStatus("Add shots to the timeline first.");
    return;
  }
  setStatus("Checking the cost…");
  await refreshClipStatus();
  if (!clipSummary) {
    setStatus("Could not check the clips. Load the song first.");
    return;
  }
  if (!clipSummary.missing) {
    setStatus("Every frame with a still already has a clip.");
    return;
  }
  const cost = Number(clipSummary.missing_cost);
  const noun = clipSummary.missing === 1 ? "clip" : "clips";
  if (!window.confirm("Make " + clipSummary.missing + " " + noun + " for about $" + cost.toFixed(2) + "?")) {
    setStatus("Cancelled. Nothing was generated.");
    return;
  }
  try {
    await startClips(null, false, cost);
  } catch (err) {
    setVideoBusy(false);
    setStatus(err.message || "Could not make the clips.");
  }
});

restore();
refreshFitControls();
renderLyrics();
syncSongPlayer();
loadRefs();
renderTimeline();
renderCast();
renderStillBin();
resumeVideo();
refreshSongLength();
