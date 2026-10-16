import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:omnivid_client/board.dart';
import 'package:omnivid_client/main.dart';

void main() {
  testWidgets('landscape board shows transcribe, generate, timeline, and master', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1280, 720));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final board = BoardController();
    await tester.pumpWidget(OmniApp(board: board));
    await tester.pump();

    expect(find.text('Transcribe'), findsWidgets);
    expect(find.text('Generate'), findsWidgets);
    expect(find.text('Drop a lyric selection here'), findsOneWidget);
    expect(find.text('Timeline'), findsOneWidget);
    expect(find.text('Feel'), findsOneWidget);
    expect(find.text('Master'), findsOneWidget);
    expect(find.text('Connect'), findsNothing);
    expect(find.text('http://<tower>:8080'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
