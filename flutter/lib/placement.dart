import 'dart:math' as math;

/// One lyric row. Times are seconds.
class LyricLine {
  const LyricLine({required this.start, required this.end, required this.text});

  final double start;
  final double end;
  final String text;

  LyricLine copyWith({String? text}) {
    return LyricLine(start: start, end: end, text: text ?? this.text);
  }
}

/// A drag payload: one line, or several lines joined the way the web board joins them.
class LyricSpan {
  const LyricSpan({required this.start, required this.end, required this.lyrics});

  final double start;
  final double end;
  final String lyrics;
}

class TimeSpan {
  const TimeSpan(this.start, this.end);

  final double start;
  final double end;
}

double round1(double value) => (value * 10).roundToDouble() / 10;

String formatTime(double t) {
  final whole = t.isFinite ? t : 0;
  final minutes = whole ~/ 60;
  final seconds = (whole - minutes * 60).toStringAsFixed(1).padLeft(4, '0');
  return '$minutes:$seconds';
}

/// Even slices across [duration]. A blank or zero duration uses 30 seconds,
/// matching the web board (`Number(duration) || 30`).
List<LyricLine> linesFromLyrics(String text, num? duration) {
  final rows = text
      .split(RegExp(r'\r?\n'))
      .map((row) => row.trim())
      .where((row) => row.isNotEmpty)
      .toList();
  if (rows.isEmpty) return const [];
  final raw = duration?.toDouble() ?? 0;
  final base = !raw.isFinite || raw == 0 ? 30.0 : raw;
  final total = math.max(rows.length * 0.1, base);
  final slice = total / rows.length;
  final lines = <LyricLine>[];
  for (var index = 0; index < rows.length; index++) {
    final start = round1(index * slice);
    final end = index == rows.length - 1 ? round1(total) : round1((index + 1) * slice);
    lines.add(LyricLine(start: start, end: math.max(end, start + 0.1), text: rows[index]));
  }
  return lines;
}

/// [selected] is in line order. The span runs from the first picked start to the last picked end.
LyricSpan? selectionPayload(List<LyricLine> lines, List<int> selected) {
  if (selected.isEmpty) return null;
  final picked = <LyricLine>[];
  for (final index in selected) {
    if (index < 0 || index >= lines.length) continue;
    picked.add(lines[index]);
  }
  if (picked.isEmpty) return null;
  return LyricSpan(
    start: picked.first.start,
    end: picked.last.end,
    lyrics: picked.map((line) => line.text).join(' '),
  );
}

/// Replace [prev] only when it is a whole space-bounded match.
String replaceWholeLine(String haystack, String prev, String next) {
  if (prev.isEmpty) return haystack;
  var out = '';
  var rest = haystack;
  while (rest.isNotEmpty) {
    final at = rest.indexOf(prev);
    if (at < 0) return out + rest;
    final before = at == 0 || rest[at - 1] == ' ';
    final afterAt = at + prev.length;
    final after = afterAt == rest.length || rest[afterAt] == ' ';
    out += rest.substring(0, at) + (before && after ? next : prev);
    rest = rest.substring(afterAt);
  }
  return out;
}

bool lineUsed(LyricLine line, List<TimeSpan> sections) {
  final span = math.max(0.1, line.end - line.start);
  for (final section in sections) {
    final overlap = math.min(section.end, line.end) - math.max(section.start, line.start);
    if (overlap > span * 0.5) return true;
  }
  return false;
}

bool alreadyPlaced(LyricSpan payload, List<({String lyrics, double start, double end})> sections) {
  final text = payload.lyrics.trim();
  for (final section in sections) {
    final sameWords = text.isNotEmpty && section.lyrics.trim() == text;
    final covers = section.start <= payload.start + 0.05 && section.end >= payload.end - 0.05;
    if (sameWords && covers) return true;
  }
  return false;
}

/// Longest free gap of at least 0.2s inside [start]–[end].
TimeSpan? fittingSpan(double start, double end, List<TimeSpan> sections) {
  final gaps = <TimeSpan>[];
  var from = start;
  final blocks = [...sections]..sort((a, b) => a.start != b.start ? a.start.compareTo(b.start) : a.end.compareTo(b.end));
  for (final block in blocks) {
    if (block.end <= from + 0.001 || block.start >= end - 0.001) continue;
    if (block.start > from + 0.001) {
      gaps.add(TimeSpan(from, math.min(block.start, end)));
    }
    from = math.max(from, block.end);
    if (from >= end - 0.001) break;
  }
  if (from < end - 0.001) gaps.add(TimeSpan(from, end));
  TimeSpan? best;
  for (final gap in gaps) {
    if (gap.end - gap.start < 0.2) continue;
    if (best == null || gap.end - gap.start > best.end - best.start) best = gap;
  }
  return best;
}

bool rangeOverlaps(double start, double end, String id, List<({String id, double start, double end})> sections) {
  for (final other in sections) {
    if (other.id == id) continue;
    if (start < other.end && other.start < end) return true;
  }
  return false;
}
