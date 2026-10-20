import 'dart:async';
import 'dart:math' as math;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:video_player/video_player.dart';

import 'api.dart';
import 'board.dart';
import 'placement.dart';

class OmniColors {
  static const bg = Color(0xFF05070C);
  static const panel = Color(0xFF0A1218);
  static const panel2 = Color(0xFF0E1820);
  static const cyan = Color(0xFF5FF6FF);
  static const cyanHot = Color(0xFFD8FFFF);
  static const text = Color(0xFFE7F7F8);
  static const muted = Color(0xFF8AA8AC);
  static const line = Color(0xFF1A4C54);
  static const warn = Color(0xFFE0B15A);
}

BoxDecoration omniFrame({bool lit = false}) {
  return BoxDecoration(
    color: lit ? OmniColors.panel2 : OmniColors.panel,
    borderRadius: BorderRadius.circular(12),
    border: Border.all(
      color: lit ? OmniColors.cyanHot : OmniColors.line,
      width: lit ? 1.4 : 1,
    ),
    boxShadow: [
      BoxShadow(
        color: OmniColors.cyan.withValues(alpha: lit ? 0.48 : 0.18),
        blurRadius: lit ? 18 : 12,
      ),
    ],
  );
}

BoxDecoration? omniSelect(bool on) {
  if (!on) return null;
  return BoxDecoration(
    color: const Color(0x3324F6FF),
    borderRadius: BorderRadius.circular(8),
    border: Border.all(color: OmniColors.cyan.withValues(alpha: 0.75)),
    boxShadow: [
      BoxShadow(color: OmniColors.cyan.withValues(alpha: 0.22), blurRadius: 10),
    ],
  );
}

ThemeData omniTheme() {
  const radius = BorderRadius.all(Radius.circular(10));
  const scheme = ColorScheme.dark(
    primary: OmniColors.cyan,
    surface: OmniColors.panel,
    onPrimary: Color(0xFF041016),
    onSurface: OmniColors.text,
  );
  return ThemeData(
    brightness: Brightness.dark,
    scaffoldBackgroundColor: OmniColors.bg,
    canvasColor: OmniColors.bg,
    colorScheme: scheme,
    dividerColor: OmniColors.line,
    visualDensity: VisualDensity.compact,
    splashColor: const Color(0x3324F6FF),
    highlightColor: const Color(0x2224F6FF),
    iconTheme: const IconThemeData(color: OmniColors.cyan),
    textTheme: const TextTheme(bodyMedium: TextStyle(color: OmniColors.text)),
    textSelectionTheme: const TextSelectionThemeData(
      cursorColor: OmniColors.cyan,
      selectionColor: Color(0x665FF6FF),
      selectionHandleColor: OmniColors.cyan,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: OmniColors.panel,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: OmniColors.cyan.withValues(alpha: 0.7)),
      ),
    ),
    checkboxTheme: CheckboxThemeData(
      side: const BorderSide(color: OmniColors.cyan, width: 1.4),
      checkColor: const WidgetStatePropertyAll(Color(0xFF041016)),
      fillColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) return OmniColors.cyan;
        return Colors.transparent;
      }),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) {
            return const Color(0xFF16343A);
          }
          return OmniColors.cyan;
        }),
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) {
            return const Color(0xFF6E8588);
          }
          return const Color(0xFF041016);
        }),
        elevation: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) return 0;
          return 8;
        }),
        shadowColor: const WidgetStatePropertyAll(Color(0xCC00F6FF)),
        visualDensity: VisualDensity.compact,
        textStyle: const WidgetStatePropertyAll(
          TextStyle(fontWeight: FontWeight.w700),
        ),
        shape: const WidgetStatePropertyAll(
          RoundedRectangleBorder(
            borderRadius: radius,
            side: BorderSide(color: OmniColors.cyanHot),
          ),
        ),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: OmniColors.cyan,
        visualDensity: VisualDensity.compact,
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: const Color(0xFF070E14),
      labelStyle: const TextStyle(color: OmniColors.muted),
      hintStyle: const TextStyle(color: OmniColors.muted),
      floatingLabelStyle: const TextStyle(color: OmniColors.cyan),
      isDense: true,
      border: OutlineInputBorder(
        borderRadius: radius,
        borderSide: const BorderSide(color: OmniColors.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: const BorderSide(color: OmniColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: const BorderSide(color: OmniColors.cyanHot, width: 1.4),
      ),
    ),
  );
}

class _FieldPainter extends CustomPainter {
  const _FieldPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    canvas.drawRect(rect, Paint()..color = OmniColors.bg);
    canvas.drawRect(
      rect,
      Paint()
        ..shader = const RadialGradient(
          center: Alignment(0, -0.72),
          radius: 1.15,
          colors: [Color(0x1A5FF6FF), Color(0x005FF6FF)],
        ).createShader(rect),
    );
    final grid = Paint()
      ..color = const Color(0x0C5FF6FF)
      ..strokeWidth = 0.6;
    const step = 32.0;
    for (var x = 0.0; x <= size.width; x += step) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), grid);
    }
    for (var y = 0.0; y <= size.height; y += step) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), grid);
    }
  }

  @override
  bool shouldRepaint(covariant _FieldPainter oldDelegate) => false;
}

class _MetronomePainter extends CustomPainter {
  const _MetronomePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final glow = Paint()
      ..color = OmniColors.cyan.withValues(alpha: 0.45)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeJoin = StrokeJoin.round
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 2.2);
    final line = Paint()
      ..color = OmniColors.cyan
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.15
      ..strokeJoin = StrokeJoin.round
      ..strokeCap = StrokeCap.round;
    final body = Path()
      ..moveTo(size.width * 0.24, size.height * 0.9)
      ..lineTo(size.width * 0.5, size.height * 0.1)
      ..lineTo(size.width * 0.76, size.height * 0.9)
      ..close();
    canvas.drawPath(body, glow);
    canvas.drawPath(body, line);
    canvas.drawLine(
      Offset(size.width * 0.5, size.height * 0.78),
      Offset(size.width * 0.66, size.height * 0.3),
      line,
    );
    canvas.drawCircle(
      Offset(size.width * 0.66, size.height * 0.3),
      1.6,
      Paint()..color = OmniColors.cyanHot,
    );
  }

  @override
  bool shouldRepaint(covariant _MetronomePainter oldDelegate) => false;
}

class _WavePainter extends CustomPainter {
  const _WavePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path();
    final mid = size.height / 2;
    const steps = 64;
    for (var i = 0; i <= steps; i++) {
      final t = i / steps;
      final x = size.width * t;
      final envelope = math.sin(t * math.pi);
      final y =
          mid - math.sin(t * 3.5 * math.pi * 2) * size.height * 0.36 * envelope;
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = OmniColors.cyan.withValues(alpha: 0.28)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.6
        ..strokeCap = StrokeCap.round
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3),
    );
    canvas.drawPath(
      path,
      Paint()
        ..color = OmniColors.cyan.withValues(alpha: 0.7)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.1
        ..strokeCap = StrokeCap.round,
    );
  }

  @override
  bool shouldRepaint(covariant _WavePainter oldDelegate) => false;
}

class BoardScreen extends StatefulWidget {
  const BoardScreen({super.key, this.board});

  final BoardController? board;

  @override
  State<BoardScreen> createState() => _BoardScreenState();
}

class _BoardScreenState extends State<BoardScreen> {
  late final BoardController board;

  @override
  void initState() {
    super.initState();
    board = widget.board ?? BoardController();
    board.addListener(_onBoard);
    board.askToExtend = _askToExtend;
  }

  Future<bool> _askToExtend(String message) async {
    if (!mounted) return false;
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text("Lyrics won't fit"),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Fit to lyrics'),
          ),
        ],
      ),
    );
    return yes == true;
  }

  void _onBoard() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    board.askToExtend = null;
    board.removeListener(_onBoard);
    board.dispose();
    super.dispose();
  }

  Future<void> _newProject() async {
    final name = await _askName('New project', 'Folder name', 'Create');
    if (name == null || !mounted) return;
    await board.createProject(name);
  }

  Future<void> _openProject() async {
    await board.refreshProjects();
    if (!mounted) return;
    final name = await showDialog<String>(
      context: context,
      builder: (context) =>
          _OpenDialog(projects: board.projects, note: board.listNote),
    );
    if (name == null || !mounted) return;
    await board.openProject(name);
  }

  Future<String?> _askName(String title, String label, String action) async {
    final field = TextEditingController();
    try {
      return await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: TextField(
            controller: field,
            autofocus: true,
            decoration: InputDecoration(labelText: label),
            onSubmitted: (value) => Navigator.pop(context, value),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, field.text),
              child: Text(action),
            ),
          ],
        ),
      );
    } finally {
      field.dispose();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: CustomPaint(
        painter: const _FieldPainter(),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 6, 8, 4),
            child: Column(
              children: [
                _Header(
                  title: board.title,
                  onOpen: _openProject,
                  onNew: _newProject,
                  onSave: board.save,
                ),
                const SizedBox(height: 6),
                Expanded(child: _BoardPage(board: board)),
                const SizedBox(height: 4),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    board.status,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: OmniColors.muted,
                      fontSize: 12,
                    ),
                  ),
                ),
                _PhoneTabs(board: board),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({
    required this.title,
    required this.onOpen,
    required this.onNew,
    required this.onSave,
  });

  final String title;
  final VoidCallback onOpen;
  final VoidCallback onNew;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    const tight = ButtonStyle(
      padding: WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 8)),
      minimumSize: WidgetStatePropertyAll(Size(0, 36)),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
    );
    return Row(
      children: [
        const SizedBox(
          width: 20,
          height: 20,
          child: CustomPaint(painter: _MetronomePainter()),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            'OmniVideo · $title',
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: OmniColors.cyan,
              fontWeight: FontWeight.w600,
              shadows: [
                Shadow(
                  color: OmniColors.cyan.withValues(alpha: 0.55),
                  blurRadius: 8,
                ),
              ],
            ),
          ),
        ),
        TextButton(style: tight, onPressed: onOpen, child: const Text('Open')),
        TextButton(style: tight, onPressed: onNew, child: const Text('New')),
        FilledButton(
          style: tight,
          onPressed: onSave,
          child: const Text('Save'),
        ),
      ],
    );
  }
}

class _PhoneTabs extends StatelessWidget {
  const _PhoneTabs({required this.board});

  final BoardController board;

  static const labels = <String, String>{
    'generate': 'Generate audio',
    'transcribe': 'Transcribe audio',
    'master': 'Master',
    'stills': 'Stills',
    'clips': 'Clips',
    'render': 'Render Video',
  };

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xF005070C),
        border: Border(
          top: BorderSide(color: OmniColors.cyan.withValues(alpha: 0.45)),
        ),
        boxShadow: [
          BoxShadow(
            color: OmniColors.cyan.withValues(alpha: 0.18),
            blurRadius: 16,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (final entry in labels.entries)
              InkWell(
                onTap: () => board.showTab(entry.key),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color: board.tab == entry.key
                        ? const Color(0x1A24F6FF)
                        : Colors.transparent,
                    border: Border(
                      top: BorderSide(
                        color: board.tab == entry.key
                            ? OmniColors.cyanHot
                            : Colors.transparent,
                        width: 2,
                      ),
                    ),
                    boxShadow: board.tab == entry.key
                        ? [
                            BoxShadow(
                              color: OmniColors.cyan.withValues(alpha: 0.32),
                              blurRadius: 12,
                              offset: const Offset(0, -2),
                            ),
                          ]
                        : null,
                  ),
                  child: Text(
                    entry.value,
                    style: TextStyle(
                      color: board.tab == entry.key
                          ? OmniColors.cyanHot
                          : OmniColors.muted,
                      fontSize: 13,
                      fontWeight: board.tab == entry.key
                          ? FontWeight.w600
                          : FontWeight.w500,
                      shadows: board.tab == entry.key
                          ? [
                              Shadow(
                                color: OmniColors.cyan.withValues(alpha: 0.65),
                                blurRadius: 8,
                              ),
                            ]
                          : null,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _BoardPage extends StatelessWidget {
  const _BoardPage({required this.board});

  final BoardController board;

  @override
  Widget build(BuildContext context) {
    switch (board.tab) {
      case 'transcribe':
        return _TranscribePane(board: board);
      case 'master':
        return _MasterPage(board: board);
      case 'stills':
        return _StillsPage(board: board);
      case 'clips':
        return _ClipsPage(board: board);
      case 'render':
        return _RenderPage(board: board);
      default:
        return _GeneratePane(board: board);
    }
  }
}

class _TranscribePane extends StatelessWidget {
  const _TranscribePane({required this.board});

  final BoardController board;

  Future<void> _pickSong() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac'],
      withData: true,
    );
    final file = result?.files.single;
    if (file == null) return;
    final bytes = file.bytes;
    if (bytes == null) {
      board.setStatus('Could not read that file.');
      return;
    }
    await board.uploadSong(bytes, file.name);
  }

  @override
  Widget build(BuildContext context) {
    final payload = selectionPayload(board.lines, board.selected);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          board.songName.isEmpty ? 'No song yet' : board.songName,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: OmniColors.text),
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            FilledButton(
              onPressed: board.locked ? null : _pickSong,
              child: const Text('Upload song'),
            ),
            if (board.lyricsSource != 'written')
              FilledButton(
                onPressed: board.locked ? null : board.transcribe,
                child: const Text('Transcribe'),
              ),
            if (payload != null)
              TextButton(
                onPressed: () => board.place(payload),
                child: Text(
                  'Place ${formatTime(payload.start)} – ${formatTime(payload.end)}',
                ),
              ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          board.lyricNote,
          style: const TextStyle(color: OmniColors.muted, fontSize: 12),
        ),
        const SizedBox(height: 4),
        Expanded(
          child: ListView.builder(
            itemCount: board.lines.length,
            itemBuilder: (context, index) {
              final line = board.lines[index];
              final on = board.selected.contains(index);
              return Draggable<LyricSpan>(
                data: board.payloadFor(index),
                feedback: Material(
                  color: Colors.transparent,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 280),
                    child: Text(
                      line.text,
                      style: const TextStyle(color: OmniColors.cyan),
                    ),
                  ),
                ),
                child: Container(
                  decoration: omniSelect(on),
                  padding: const EdgeInsets.symmetric(
                    vertical: 2,
                    horizontal: 4,
                  ),
                  child: Row(
                    children: [
                      GestureDetector(
                        onTap: () => board.extendSelection(index),
                        child: Text(
                          formatTime(line.start),
                          style: const TextStyle(
                            color: OmniColors.muted,
                            fontSize: 12,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: GestureDetector(
                          onTap: () => board.selectLine(index),
                          child: Text(
                            line.text,
                            style: TextStyle(
                              color: board.lineIsUsed(line)
                                  ? OmniColors.muted
                                  : OmniColors.text,
                            ),
                          ),
                        ),
                      ),
                      TextButton(
                        onPressed: () async {
                          final next = await _editLine(context, line.text);
                          if (next != null && context.mounted) {
                            board.editLine(index, next);
                          }
                        },
                        child: const Text('Edit'),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

Future<String?> _editLine(BuildContext context, String text) async {
  final field = TextEditingController(text: text);
  try {
    return await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Edit line'),
        content: TextField(controller: field, autofocus: true, maxLines: 4),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, field.text),
            child: const Text('Save'),
          ),
        ],
      ),
    );
  } finally {
    field.dispose();
  }
}

class _GeneratePane extends StatelessWidget {
  const _GeneratePane({required this.board});

  final BoardController board;

  @override
  Widget build(BuildContext context) {
    const lengths = [15, 30, 45, 60, 120, 180, 300];
    final hasLyrics = board.draftLyrics.trim().isNotEmpty;
    final fit = board.fitLyrics && hasLyrics;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SyncedField(
          epoch: board.epoch,
          value: board.style,
          label: 'Style or mood',
          onChanged: board.setStyle,
        ),
        const SizedBox(height: 6),
        Expanded(
          child: SyncedField(
            epoch: board.epoch,
            value: board.draftLyrics,
            label: 'Lyrics',
            hint: 'Optional. Leave blank for instrumental.',
            maxLines: null,
            expands: true,
            onChanged: board.setDraftLyrics,
          ),
        ),
        const SizedBox(height: 4),
        const SizedBox(height: 18, child: CustomPaint(painter: _WavePainter())),
        const SizedBox(height: 2),
        Row(
          children: [
            Checkbox(
              value: fit,
              visualDensity: VisualDensity.compact,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              onChanged: hasLyrics && !board.audioJob
                  ? (value) => board.setFitLyrics(value ?? false)
                  : null,
            ),
            const Expanded(child: Text('Full song / fit to lyrics')),
          ],
        ),
        Wrap(
          spacing: 8,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            DropdownButton<int>(
              value: lengths.contains(board.length) ? board.length : 30,
              dropdownColor: OmniColors.panel,
              style: const TextStyle(color: OmniColors.text, fontSize: 14),
              iconEnabledColor: OmniColors.cyan,
              underline: Container(
                height: 1,
                color: OmniColors.cyan.withValues(alpha: 0.7),
              ),
              items: [
                for (final seconds in lengths)
                  DropdownMenuItem(
                    value: seconds,
                    child: Text(_lengthLabel(seconds)),
                  ),
              ],
              onChanged: board.audioJob || fit
                  ? null
                  : (value) {
                      if (value != null) board.setLength(value);
                    },
            ),
            TextButton(
              onPressed: board.audioJob ? null : board.suggestLyrics,
              child: const Text('Suggest lyrics'),
            ),
            FilledButton(
              onPressed: board.audioJob ? null : board.generateAudio,
              child: const Text('Generate'),
            ),
          ],
        ),
        const SizedBox(height: 6),
        _AudioBar(
          url: board.generated == null
              ? ''
              : board.api.absolute(board.generated!.url),
          enabled: !board.audioJob && board.generated != null,
          onUse: board.useTrack,
        ),
      ],
    );
  }
}

String _lengthLabel(int seconds) {
  final minutes = seconds ~/ 60;
  final rest = seconds % 60;
  return '$minutes:${rest.toString().padLeft(2, '0')}';
}

class _AudioBar extends StatefulWidget {
  const _AudioBar({
    required this.url,
    required this.enabled,
    required this.onUse,
  });

  final String url;
  final bool enabled;
  final Future<void> Function() onUse;

  @override
  State<_AudioBar> createState() => _AudioBarState();
}

class _AudioBarState extends State<_AudioBar> {
  AudioPlayer? _player;
  StreamSubscription<PlayerState>? _stateSub;
  StreamSubscription<Duration>? _positionSub;
  bool _playing = false;
  Duration _position = Duration.zero;

  @override
  void didUpdateWidget(_AudioBar old) {
    super.didUpdateWidget(old);
    if (widget.url != old.url && widget.url.isNotEmpty) {
      unawaited(_open(widget.url));
    }
  }

  Future<void> _open(String url) async {
    final player = _player ??= AudioPlayer();
    _stateSub ??= player.playerStateStream.listen((state) {
      if (mounted) setState(() => _playing = state.playing);
    });
    _positionSub ??= player.positionStream.listen((position) {
      if (mounted) setState(() => _position = position);
    });
    try {
      await player.setUrl(url);
    } catch (_) {
      if (mounted) setState(() {});
    }
  }

  Future<void> _toggle() async {
    if (widget.url.isEmpty) return;
    final player = _player ??= AudioPlayer();
    if (player.audioSource == null) await _open(widget.url);
    if (player.playing) {
      await player.pause();
    } else {
      await player.play();
    }
  }

  @override
  void dispose() {
    _stateSub?.cancel();
    _positionSub?.cancel();
    _player?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final clock = _position.inSeconds;
    return DecoratedBox(
      decoration: omniFrame(lit: widget.url.isNotEmpty),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        child: Wrap(
          spacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            TextButton(
              onPressed: widget.enabled ? _toggle : null,
              child: Text(_playing ? 'Pause' : 'Play'),
            ),
            Text(
              widget.url.isEmpty
                  ? 'No track yet'
                  : '${clock ~/ 60}:${(clock % 60).toString().padLeft(2, '0')}',
              style: const TextStyle(color: OmniColors.muted, fontSize: 12),
            ),
            TextButton(
              onPressed: widget.enabled ? widget.onUse : null,
              child: const Text('Use this track'),
            ),
          ],
        ),
      ),
    );
  }
}

Future<void> _pickStills(BoardController board, String? shotId) async {
  final result = await FilePicker.platform.pickFiles(
    type: FileType.custom,
    allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp'],
    allowMultiple: true,
    withData: true,
  );
  if (result == null) return;
  final files = <StillFile>[];
  for (final file in result.files) {
    final bytes = file.bytes;
    if (bytes == null) continue;
    files.add(StillFile(bytes: bytes, filename: file.name));
  }
  if (files.isEmpty) {
    board.setStatus('Could not read that image.');
    return;
  }
  await board.uploadStills(files, shotId: shotId);
}

class _StillsPage extends StatefulWidget {
  const _StillsPage({required this.board});

  final BoardController board;

  @override
  State<_StillsPage> createState() => _StillsPageState();
}

class _StillsPageState extends State<_StillsPage> {
  String? _picked;

  @override
  Widget build(BuildContext context) {
    final board = widget.board;
    final picked = board.uploads
        .where((item) => item.id == _picked)
        .firstOrNull;
    return ListView(
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            FilledButton(
              onPressed: board.locked ? null : () => _pickStills(board, null),
              child: const Text('Upload stills'),
            ),
            FilledButton(
              onPressed: board.locked ? null : board.generateImages,
              child: const Text('Generate images'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          picked == null
              ? 'Upload a JPEG, PNG, or WebP, then tap it and assign it to a shot.'
              : 'Selected ${picked.name.isEmpty ? 'still' : picked.name}. Tap Assign on the shot it belongs to.',
          style: const TextStyle(color: OmniColors.muted, fontSize: 12),
        ),
        const SizedBox(height: 8),
        if (board.uploads.isEmpty)
          const Text(
            'No unassigned stills.',
            style: TextStyle(color: OmniColors.muted, fontSize: 12),
          )
        else
          for (final item in board.uploads)
            Draggable<StillDrag>(
              data: StillDrag(item.id),
              feedback: const Material(
                color: Colors.transparent,
                child: Icon(Icons.image, color: OmniColors.cyan),
              ),
              child: Builder(
                builder: (context) {
                  final on = item.id == _picked;
                  return Container(
                    margin: const EdgeInsets.only(bottom: 6),
                    decoration: omniSelect(on),
                    child: Row(
                      children: [
                        _StillThumb(
                          board: board,
                          image: item.url,
                          onTap: () => setState(() => _picked = item.id),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: GestureDetector(
                            onTap: () => setState(() => _picked = item.id),
                            child: Text(
                              item.name.isEmpty ? 'Still' : item.name,
                              style: const TextStyle(color: OmniColors.text),
                            ),
                          ),
                        ),
                        TextButton(
                          onPressed: () => board.deleteUpload(item.id),
                          child: const Text('Remove'),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
        const SizedBox(height: 8),
        if (board.sections.isEmpty)
          const Text(
            'Place lyrics on the Transcribe tab before assigning a still.',
            style: TextStyle(color: OmniColors.muted, fontSize: 12),
          ),
        for (final shot in board.sections)
          DragTarget<StillDrag>(
            onAcceptWithDetails: (details) =>
                board.assignStill(shot.id, details.data.id),
            builder: (context, candidates, rejected) {
              return Container(
                margin: const EdgeInsets.only(top: 6),
                padding: const EdgeInsets.all(6),
                decoration: omniFrame(lit: candidates.isNotEmpty),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _StillThumb(
                      board: board,
                      image: shot.image,
                      onTap: () => _pickStills(board, shot.id),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${formatTime(shot.start)} – ${formatTime(shot.end)}',
                            style: const TextStyle(
                              color: OmniColors.text,
                              fontSize: 12,
                            ),
                          ),
                          Text(
                            shot.lyrics,
                            style: const TextStyle(
                              color: OmniColors.text,
                              fontSize: 13,
                            ),
                          ),
                          if (_picked != null)
                            TextButton(
                              onPressed: () =>
                                  board.assignStill(shot.id, _picked!),
                              child: const Text('Assign'),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
      ],
    );
  }
}

class _ClipsPage extends StatefulWidget {
  const _ClipsPage({required this.board});

  final BoardController board;

  @override
  State<_ClipsPage> createState() => _ClipsPageState();
}

class _ClipsPageState extends State<_ClipsPage> {
  String? _playing;

  @override
  Widget build(BuildContext context) {
    final board = widget.board;
    return DragTarget<LyricSpan>(
      onAcceptWithDetails: (details) => board.place(details.data),
      builder: (context, candidates, rejected) {
        return ListView(
          children: [
            Text(
              candidates.isNotEmpty ? 'Drop to add this clip' : board.dropHint,
              style: const TextStyle(color: OmniColors.muted, fontSize: 12),
            ),
            if (_playing != null) ...[
              const SizedBox(height: 8),
              _Movie(url: _playing!),
            ],
            if (board.sections.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  'Place a lyric selection on the Transcribe tab. Each scene becomes a clip.',
                  style: TextStyle(color: OmniColors.muted, fontSize: 12),
                ),
              ),
            for (final shot in board.sections)
              _ShotCard(
                board: board,
                shot: shot,
                clips: [
                  for (final clip in board.motionClips)
                    if (clip.sectionId == shot.id) clip,
                ],
                onUpload: () => _pickStills(board, shot.id),
                onPlay: (url) => setState(() => _playing = url),
              ),
          ],
        );
      },
    );
  }
}

class _ShotCard extends StatelessWidget {
  const _ShotCard({
    required this.board,
    required this.shot,
    required this.onUpload,
    required this.clips,
    required this.onPlay,
  });

  final BoardController board;
  final Shot shot;
  final VoidCallback onUpload;
  final List<MotionClip> clips;
  final ValueChanged<String> onPlay;

  @override
  Widget build(BuildContext context) {
    final span = shot.end - shot.start;
    return DragTarget<StillDrag>(
      onAcceptWithDetails: (details) =>
          board.assignStill(shot.id, details.data.id),
      builder: (context, candidates, rejected) {
        return Container(
          margin: const EdgeInsets.only(top: 6),
          padding: const EdgeInsets.all(6),
          decoration: omniFrame(lit: candidates.isNotEmpty),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Text(
                    '${formatTime(shot.start)} – ${formatTime(shot.end)}',
                    style: const TextStyle(
                      color: OmniColors.text,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '${span.toStringAsFixed(1)}s',
                    style: const TextStyle(
                      color: OmniColors.muted,
                      fontSize: 12,
                    ),
                  ),
                  if (span > 15)
                    const Padding(
                      padding: EdgeInsets.only(left: 6),
                      child: Text(
                        'Over 15s',
                        style: TextStyle(color: OmniColors.warn, fontSize: 12),
                      ),
                    ),
                  if (board.shotOverlaps(shot))
                    const Padding(
                      padding: EdgeInsets.only(left: 6),
                      child: Text(
                        'Overlaps',
                        style: TextStyle(color: OmniColors.warn, fontSize: 12),
                      ),
                    ),
                  const Spacer(),
                  TextButton(
                    onPressed: () => board.removeShot(shot.id),
                    child: const Text('Remove'),
                  ),
                ],
              ),
              Text(
                shot.lyrics.trim().isNotEmpty
                    ? shot.lyrics
                    : shot.role == 'cover'
                        ? 'Cover'
                        : shot.role == 'credit'
                            ? 'End credit'
                            : shot.role == 'fill'
                                ? 'Card'
                                : shot.lyrics,
                style: TextStyle(
                  color: shot.lyrics.trim().isEmpty &&
                          (shot.role == 'cover' || shot.role == 'credit' || shot.role == 'fill')
                      ? OmniColors.cyan
                      : OmniColors.text,
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: 4),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _StillThumb(board: board, image: shot.image, onTap: onUpload),
                  const SizedBox(width: 6),
                  Expanded(
                    child: SyncedField(
                      epoch: board.epoch,
                      value: shot.prompt,
                      hint: shot.suggesting
                          ? 'Suggesting a prompt from these lyrics…'
                          : 'What this shot should show',
                      maxLines: 3,
                      onChanged: (value) => board.setPrompt(shot.id, value),
                    ),
                  ),
                ],
              ),
              Wrap(
                spacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (clips.isEmpty)
                    const Text(
                      'No clip yet',
                      style: TextStyle(color: OmniColors.muted, fontSize: 12),
                    )
                  else
                    for (final clip in clips)
                      TextButton(
                        onPressed: () => onPlay(board.api.absolute(clip.url)),
                        child: Text(
                          clips.length == 1 ? 'Play' : 'Play ${clip.index + 1}',
                        ),
                      ),
                  TextButton(
                    onPressed: board.locked
                        ? null
                        : () => board.regenerate(shot.id),
                    child: const Text('Regenerate'),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }
}

class _StillThumb extends StatelessWidget {
  const _StillThumb({
    required this.board,
    required this.image,
    required this.onTap,
  });

  final BoardController board;
  final String image;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final bare = image.split('?').first;
    final child = bare.isEmpty
        ? const Center(
            child: Text(
              'Drop still',
              style: TextStyle(color: OmniColors.muted, fontSize: 11),
            ),
          )
        : Image.network(
            board.api.absolute(image),
            fit: BoxFit.cover,
            errorBuilder: (context, error, stack) => const SizedBox.shrink(),
          );
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(6),
        boxShadow: [
          BoxShadow(
            color: OmniColors.cyan.withValues(alpha: 0.28),
            blurRadius: 8,
          ),
        ],
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(6),
        child: Container(
          width: 96,
          height: 54,
          decoration: BoxDecoration(
            color: Colors.black,
            border: Border.all(color: OmniColors.cyan.withValues(alpha: 0.7)),
            borderRadius: BorderRadius.circular(6),
          ),
          clipBehavior: Clip.antiAlias,
          child: child,
        ),
      ),
    );
  }
}

class StillDrag {
  const StillDrag(this.id);

  final String id;
}

class _MasterPage extends StatelessWidget {
  const _MasterPage({required this.board});

  final BoardController board;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        SyncedField(
          epoch: board.epoch,
          value: board.feel,
          label: 'Feel',
          onChanged: board.setFeel,
        ),
        const SizedBox(height: 8),
        const Text(
          'Characters',
          style: TextStyle(color: OmniColors.muted, fontSize: 12),
        ),
        for (var i = 0; i < board.cast.length; i++) ...[
          const SizedBox(height: 4),
          SyncedField(
            epoch: board.epoch,
            value: board.cast[i].name,
            label: 'Name',
            onChanged: (value) => board.setCharacter(i, name: value),
          ),
          const SizedBox(height: 4),
          SyncedField(
            epoch: board.epoch,
            value: board.cast[i].look,
            label: 'Look',
            maxLines: 2,
            onChanged: (value) => board.setCharacter(i, look: value),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () => board.removeCharacter(i),
              child: const Text('Remove'),
            ),
          ),
        ],
        if (board.cast.length < 8)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: board.addCharacter,
              child: const Text('Add character'),
            ),
          ),
        const SizedBox(height: 6),
        SyncedField(
          epoch: board.epoch,
          value: board.masterPrompt,
          label: 'Master prompt',
          maxLines: 4,
          onChanged: board.setMaster,
        ),
      ],
    );
  }
}

class _RenderPage extends StatelessWidget {
  const _RenderPage({required this.board});

  final BoardController board;

  @override
  Widget build(BuildContext context) {
    final quote = board.quote;
    return ListView(
      children: [
        const Text(
          'Assembles the current clips. Cached clips are not generated again. New motion asks for the cost before it starts.',
          style: TextStyle(color: OmniColors.muted, fontSize: 12),
        ),
        const SizedBox(height: 10),
        FilledButton(
          onPressed: board.locked ? null : board.estimateVideo,
          child: const Text('Render video'),
        ),
        if (quote != null) ...[
          const SizedBox(height: 6),
          Text(
            quote.note,
            style: const TextStyle(color: OmniColors.text, fontSize: 12),
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 8,
            children: [
              FilledButton(
                onPressed: board.confirmVideo,
                child: Text(quote.label),
              ),
              TextButton(
                onPressed: board.cancelVideo,
                child: const Text('Cancel'),
              ),
            ],
          ),
        ],
        if (board.videoNote.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              board.videoNote,
              style: const TextStyle(color: OmniColors.muted, fontSize: 12),
            ),
          ),
        if (board.videoSrc.isNotEmpty) ...[
          const SizedBox(height: 8),
          _Movie(url: board.api.absolute(board.videoSrc)),
        ],
      ],
    );
  }
}

class _Movie extends StatefulWidget {
  const _Movie({required this.url});

  final String url;

  @override
  State<_Movie> createState() => _MovieState();
}

class _MovieState extends State<_Movie> {
  VideoPlayerController? _controller;
  String _error = '';

  @override
  void initState() {
    super.initState();
    unawaited(_load(widget.url));
  }

  @override
  void didUpdateWidget(_Movie old) {
    super.didUpdateWidget(old);
    if (widget.url != old.url) unawaited(_load(widget.url));
  }

  Future<void> _load(String url) async {
    final previous = _controller;
    final next = VideoPlayerController.networkUrl(Uri.parse(url));
    _controller = next;
    await previous?.dispose();
    try {
      await next.initialize();
      if (!mounted || _controller != next) {
        await next.dispose();
        return;
      }
      setState(() => _error = '');
    } catch (_) {
      if (!mounted || _controller != next) return;
      setState(() => _error = 'The video file is missing.');
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (_error.isNotEmpty) {
      return Text(
        _error,
        style: const TextStyle(color: OmniColors.warn, fontSize: 12),
      );
    }
    if (controller == null || !controller.value.isInitialized) {
      return const SizedBox(
        height: 24,
        child: Text(
          'Loading video…',
          style: TextStyle(color: OmniColors.muted, fontSize: 12),
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DecoratedBox(
          decoration: omniFrame(),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: AspectRatio(
              aspectRatio: controller.value.aspectRatio,
              child: VideoPlayer(controller),
            ),
          ),
        ),
        TextButton(
          onPressed: () {
            if (controller.value.isPlaying) {
              controller.pause();
            } else {
              controller.play();
            }
            setState(() {});
          },
          child: Text(controller.value.isPlaying ? 'Pause' : 'Play'),
        ),
      ],
    );
  }
}

class SyncedField extends StatefulWidget {
  const SyncedField({
    super.key,
    required this.epoch,
    required this.value,
    required this.onChanged,
    this.label,
    this.hint,
    this.maxLines = 1,
    this.expands = false,
  });

  final int epoch;
  final String value;
  final ValueChanged<String> onChanged;
  final String? label;
  final String? hint;
  final int? maxLines;
  final bool expands;

  @override
  State<SyncedField> createState() => _SyncedFieldState();
}

class _SyncedFieldState extends State<SyncedField> {
  late final TextEditingController _controller;
  late final FocusNode _focus;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.value);
    _focus = FocusNode()..addListener(_onFocus);
  }

  void _onFocus() {
    if (mounted) setState(() {});
  }

  @override
  void didUpdateWidget(SyncedField old) {
    super.didUpdateWidget(old);
    final external =
        widget.epoch != old.epoch ||
        (!_focus.hasFocus && widget.value != _controller.text);
    if (external && widget.value != _controller.text) {
      _controller.value = TextEditingValue(
        text: widget.value,
        selection: TextSelection.collapsed(offset: widget.value.length),
      );
    }
  }

  @override
  void dispose() {
    _focus.removeListener(_onFocus);
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final lit = _focus.hasFocus;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        boxShadow: lit
            ? [
                BoxShadow(
                  color: OmniColors.cyan.withValues(alpha: 0.38),
                  blurRadius: 14,
                ),
              ]
            : const [],
      ),
      child: TextField(
        controller: _controller,
        focusNode: _focus,
        expands: widget.expands,
        maxLines: widget.expands ? null : widget.maxLines,
        minLines: widget.expands ? null : 1,
        textAlignVertical: widget.expands ? TextAlignVertical.top : null,
        style: const TextStyle(color: OmniColors.text, fontSize: 13),
        decoration: InputDecoration(
          labelText: widget.label,
          hintText: widget.hint,
          alignLabelWithHint: widget.maxLines != 1 || widget.expands,
        ),
        onChanged: widget.onChanged,
      ),
    );
  }
}

class _OpenDialog extends StatefulWidget {
  const _OpenDialog({required this.projects, required this.note});

  final List<ProjectName> projects;
  final String note;

  @override
  State<_OpenDialog> createState() => _OpenDialogState();
}

class _OpenDialogState extends State<_OpenDialog> {
  final _field = TextEditingController();

  @override
  void dispose() {
    _field.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Open project'),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _field,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Project name'),
              onSubmitted: (value) => Navigator.pop(context, value),
            ),
            if (widget.note.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  widget.note,
                  style: const TextStyle(color: OmniColors.muted, fontSize: 12),
                ),
              ),
            if (widget.projects.isNotEmpty)
              SizedBox(
                height: 180,
                child: ListView(
                  children: [
                    for (final project in widget.projects)
                      ListTile(
                        dense: true,
                        title: Text(project.name),
                        onTap: () => Navigator.pop(context, project.name),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, _field.text),
          child: const Text('Open'),
        ),
      ],
    );
  }
}
