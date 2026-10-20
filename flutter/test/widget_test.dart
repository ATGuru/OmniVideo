import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:omnivid_client/board.dart';
import 'package:omnivid_client/main.dart';

void main() {
  testWidgets('phone tabs fill the screen in portrait and landscape', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final board = BoardController();
    await tester.pumpWidget(OmniApp(board: board));
    await tester.pump();

    expect(find.text('Generate audio'), findsOneWidget);
    expect(find.text('Transcribe audio'), findsOneWidget);
    expect(find.text('Master'), findsOneWidget);
    expect(find.text('Stills'), findsOneWidget);
    expect(find.text('Clips'), findsOneWidget);
    expect(find.text('Render Video'), findsOneWidget);
    expect(find.text('Style or mood'), findsOneWidget);
    expect(find.text('Full song / fit to lyrics'), findsOneWidget);
    expect(find.text('Use this track'), findsOneWidget);
    expect(find.text('Timeline'), findsNothing);
    expect(tester.takeException(), isNull);

    await tester.ensureVisible(find.text('Transcribe audio'));
    await tester.tap(find.text('Transcribe audio'));
    await tester.pump();
    expect(find.text('Upload song'), findsOneWidget);

    await tester.ensureVisible(find.text('Master'));
    await tester.tap(find.text('Master'));
    await tester.pump();
    expect(find.text('Feel'), findsOneWidget);
    expect(find.text('Master prompt'), findsOneWidget);

    await tester.ensureVisible(find.text('Stills'));
    await tester.tap(find.text('Stills'));
    await tester.pump();
    expect(find.text('Upload stills'), findsOneWidget);

    await tester.ensureVisible(find.text('Clips'));
    await tester.tap(find.text('Clips'));
    await tester.pump();
    expect(find.text('Drop a lyric selection here'), findsOneWidget);

    await tester.ensureVisible(find.text('Render Video'));
    await tester.tap(find.text('Render Video'));
    await tester.pump();
    expect(find.text('Render video'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.binding.setSurfaceSize(const Size(1280, 720));
    await tester.pump();
    expect(find.text('Generate audio'), findsOneWidget);
    expect(find.text('Render Video'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('Generate audio'));
    await tester.pump();
    expect(find.text('Full song / fit to lyrics'), findsOneWidget);
    expect(find.text('Style or mood'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('lyrics turn full song on until a preset is forced', () {
    final board = BoardController();
    addTearDown(board.dispose);
    expect(board.fitLyrics, isFalse);
    board.setDraftLyrics('line one\nline two');
    expect(board.fitLyrics, isTrue);
    board.setLength(15);
    expect(board.fitLyrics, isFalse);
    expect(board.length, 15);
    board.setDraftLyrics('line one\nline two\nline three');
    expect(board.fitLyrics, isFalse);
    board.setFitLyrics(true);
    expect(board.fitLyrics, isTrue);
    board.setDraftLyrics('   ');
    expect(board.fitLyrics, isFalse);
    board.setDraftLyrics('back');
    expect(board.fitLyrics, isTrue);
  });
}
