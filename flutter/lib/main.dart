import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'board.dart';
import 'board_view.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations(const [
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);
  runApp(const OmniApp());
}

class OmniApp extends StatelessWidget {
  const OmniApp({super.key, this.board});

  final BoardController? board;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'OmniVideo',
      debugShowCheckedModeBanner: false,
      theme: omniTheme(),
      home: BoardScreen(board: board),
    );
  }
}
