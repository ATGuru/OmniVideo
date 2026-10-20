import 'package:flutter_test/flutter_test.dart';
import 'package:omnivid_client/placement.dart';

void main() {
  test('linesFromLyrics spreads lines across the duration', () {
    final lines = linesFromLyrics('A\nB\nC', 30);
    expect(lines.map((line) => line.text), ['A', 'B', 'C']);
    expect(lines.map((line) => line.start), [0, 10, 20]);
    expect(lines.map((line) => line.end), [10, 20, 30]);
  });

  test('a blank duration falls back to 30 seconds and blank text is empty', () {
    expect(linesFromLyrics('Hi', 0).single.end, 30);
    expect(linesFromLyrics('Hi', null).single.end, 30);
    expect(linesFromLyrics('  \n', 30), isEmpty);
  });

  test('selectionPayload uses the first start, the last end, and joins words', () {
    final lines = [
      const LyricLine(start: 1, end: 2, text: 'one'),
      const LyricLine(start: 2, end: 4, text: 'two'),
    ];
    final span = selectionPayload(lines, [0, 1]);
    expect(span, isNotNull);
    expect(span!.start, 1);
    expect(span.end, 4);
    expect(span.lyrics, 'one two');
  });

  test('replaceWholeLine keeps partial words', () {
    expect(replaceWholeLine('one two one', 'one', '1'), '1 two 1');
    expect(replaceWholeLine('done', 'one', '1'), 'done');
  });

  test('alreadyPlaced refuses the same words covering the span', () {
    const payload = LyricSpan(start: 0, end: 10, lyrics: 'a b');
    expect(
      alreadyPlaced(payload, [(lyrics: 'a b', start: 0, end: 10)]),
      isTrue,
    );
    expect(
      alreadyPlaced(payload, [(lyrics: 'other', start: 0, end: 10)]),
      isFalse,
    );
  });

  test('fittingSpan keeps the longest free gap of at least 0.2s', () {
    final fit = fittingSpan(0, 20, [const TimeSpan(0, 5), const TimeSpan(10, 12)]);
    expect(fit, isNotNull);
    expect(fit!.start, 12);
    expect(fit.end, 20);
    expect(fittingSpan(0, 5, [const TimeSpan(0, 5)]), isNull);
  });

  test('lineUsed marks a line covered by more than half', () {
    const line = LyricLine(start: 0, end: 10, text: 'line');
    expect(lineUsed(line, [const TimeSpan(0, 6)]), isTrue);
    expect(lineUsed(line, [const TimeSpan(0, 4)]), isFalse);
  });
}
