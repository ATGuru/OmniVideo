import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:video_player/video_player.dart';

import 'api.dart';
import 'board.dart';
import 'placement.dart';

class OmniColors {
  static const bg = Color(0xFF0A0A0F);
  static const panel = Color(0xFF12121A);
  static const panel2 = Color(0xFF181824);
  static const cyan = Color(0xFF00FFFF);
  static const text = Color(0xFFE6E6E6);
  static const muted = Color(0xFF8E8E9A);
  static const line = Color(0xFF2A2A36);
  static const warn = Color(0xFFE0B15A);
}

ThemeData omniTheme() {
  const scheme = ColorScheme.dark(
    primary: OmniColors.cyan,
    surface: OmniColors.panel,
    onPrimary: Colors.black,
    onSurface: OmniColors.text,
  );
  return ThemeData(
    brightness: Brightness.dark,
    scaffoldBackgroundColor: OmniColors.bg,
    colorScheme: scheme,
    dividerColor: OmniColors.line,
    visualDensity: VisualDensity.compact,
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: OmniColors.cyan,
        foregroundColor: Colors.black,
        visualDensity: VisualDensity.compact,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: OmniColors.cyan, visualDensity: VisualDensity.compact),
    ),
    inputDecorationTheme: const InputDecorationTheme(
      filled: true,
      fillColor: OmniColors.panel2,
      labelStyle: TextStyle(color: OmniColors.muted),
      hintStyle: TextStyle(color: OmniColors.muted),
      border: OutlineInputBorder(borderSide: BorderSide(color: OmniColors.line)),
      enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: OmniColors.line)),
      focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: OmniColors.cyan)),
      isDense: true,
    ),
  );
}

class BoardScreen extends StatefulWidget {
  const BoardScreen({super.key, this.board});

  final BoardController? board;

  @override
  State<BoardScreen> createState() => _BoardScreenState();
}

class _BoardScreenState extends State<BoardScreen> {
  late final BoardController board;
  final _url = TextEditingController();
  final _urlFocus = FocusNode();

  @override
  void initState() {
    super.initState();
    board = widget.board ?? BoardController();
    _url.text = board.baseUrl;
    board.addListener(_onBoard);
  }

  void _onBoard() {
    if (!mounted) return;
    if (!_urlFocus.hasFocus && _url.text != board.baseUrl) {
      _url.text = board.baseUrl;
    }
    setState(() {});
  }

  @override
  void dispose() {
    board.removeListener(_onBoard);
    board.dispose();
    _url.dispose();
    _urlFocus.dispose();
    super.dispose();
  }

  Future<void> _commitUrl() async {
    await board.setBaseUrl(_url.text);
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
      builder: (context) => _OpenDialog(projects: board.projects, note: board.listNote),
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
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(context, field.text), child: Text(action)),
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
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 6, 8, 4),
          child: Column(
            children: [
              _Header(
                title: board.title,
                url: _url,
                urlFocus: _urlFocus,
                onUrl: _commitUrl,
                onConnect: () async {
                  await _commitUrl();
                  if (!mounted) return;
                  await board.connect();
                },
                onOpen: _openProject,
                onNew: _newProject,
                onSave: board.save,
              ),
              const SizedBox(height: 6),
              Expanded(
                child: Row(
                  children: [
                    Expanded(child: _LeftColumn(board: board)),
                    const SizedBox(width: 6),
                    Expanded(child: _TimelineColumn(board: board)),
                    const SizedBox(width: 6),
                    Expanded(child: _MasterColumn(board: board)),
                  ],
                ),
              ),
              const SizedBox(height: 4),
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  board.status,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: OmniColors.muted, fontSize: 12),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({
    required this.title,
    required this.url,
    required this.urlFocus,
    required this.onUrl,
    required this.onConnect,
    required this.onOpen,
    required this.onNew,
    required this.onSave,
  });

  final String title;
  final TextEditingController url;
  final FocusNode urlFocus;
  final Future<void> Function() onUrl;
  final Future<void> Function() onConnect;
  final VoidCallback onOpen;
  final VoidCallback onNew;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Text('OmniVideo', style: TextStyle(color: OmniColors.cyan, fontWeight: FontWeight.w600)),
        const SizedBox(width: 10),
        Expanded(
          child: Text(title, overflow: TextOverflow.ellipsis, style: const TextStyle(color: OmniColors.text)),
        ),
        SizedBox(
          width: 210,
          child: TextField(
            controller: url,
            focusNode: urlFocus,
            style: const TextStyle(color: OmniColors.text, fontSize: 13),
            decoration: const InputDecoration(hintText: 'http://<tower>:8080'),
            onSubmitted: (_) => onUrl(),
            onEditingComplete: onUrl,
          ),
        ),
        TextButton(onPressed: onConnect, child: const Text('Connect')),
        TextButton(onPressed: onOpen, child: const Text('Open')),
        TextButton(onPressed: onNew, child: const Text('New')),
        FilledButton(onPressed: onSave, child: const Text('Save')),
      ],
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: OmniColors.panel,
        border: Border.all(color: OmniColors.line),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(padding: const EdgeInsets.all(8), child: child),
    );
  }
}

class _LeftColumn extends StatelessWidget {
  const _LeftColumn({required this.board});

  final BoardController board;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              _Tab(label: 'Transcribe', selected: board.tab == 'transcribe', onTap: () => board.showTab('transcribe')),
              const SizedBox(width: 6),
              _Tab(label: 'Generate', selected: board.tab == 'generate', onTap: () => board.showTab('generate')),
            ],
          ),
          const SizedBox(height: 8),
          Expanded(
            child: board.tab == 'generate' ? _GeneratePane(board: board) : _TranscribePane(board: board),
          ),
        ],
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  const _Tab({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Material(
        color: selected ? OmniColors.panel2 : Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(6),
          side: BorderSide(color: selected ? OmniColors.cyan : OmniColors.line),
        ),
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Text(label, textAlign: TextAlign.center, style: const TextStyle(color: OmniColors.text)),
          ),
        ),
      ),
    );
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
            FilledButton(onPressed: board.locked ? null : _pickSong, child: const Text('Upload song')),
            if (board.lyricsSource != 'written')
              FilledButton(onPressed: board.locked ? null : board.transcribe, child: const Text('Transcribe')),
            if (payload != null)
              TextButton(
                onPressed: () => board.place(payload),
                child: Text('Place ${formatTime(payload.start)} – ${formatTime(payload.end)}'),
              ),
          ],
        ),
        const SizedBox(height: 6),
        Text(board.lyricNote, style: const TextStyle(color: OmniColors.muted, fontSize: 12)),
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
                    child: Text(line.text, style: const TextStyle(color: OmniColors.cyan)),
                  ),
                ),
                child: Container(
                  color: on ? const Color(0x3300FFFF) : Colors.transparent,
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    children: [
                      GestureDetector(
                        onTap: () => board.extendSelection(index),
                        child: Text(formatTime(line.start), style: const TextStyle(color: OmniColors.muted, fontSize: 12)),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: GestureDetector(
                          onTap: () => board.selectLine(index),
                          child: Text(
                            line.text,
                            style: TextStyle(color: board.lineIsUsed(line) ? OmniColors.muted : OmniColors.text),
                          ),
                        ),
                      ),
                      TextButton(
                        onPressed: () async {
                          final next = await _editLine(context, line.text);
                          if (next != null && context.mounted) board.editLine(index, next);
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
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, field.text), child: const Text('Save')),
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SyncedField(epoch: board.epoch, value: board.style, label: 'Style or mood', onChanged: board.setStyle),
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
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            DropdownButton<int>(
              value: lengths.contains(board.length) ? board.length : 30,
              dropdownColor: OmniColors.panel2,
              items: [
                for (final seconds in lengths)
                  DropdownMenuItem(value: seconds, child: Text(_lengthLabel(seconds))),
              ],
              onChanged: board.audioJob ? null : (value) {
                if (value != null) board.setLength(value);
              },
            ),
            TextButton(onPressed: board.audioJob ? null : board.suggestLyrics, child: const Text('Suggest lyrics')),
            FilledButton(onPressed: board.audioJob ? null : board.generateAudio, child: const Text('Generate')),
          ],
        ),
        const SizedBox(height: 6),
        _AudioBar(
          url: board.generated == null ? '' : board.api.absolute(board.generated!.url),
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
  const _AudioBar({required this.url, required this.enabled, required this.onUse});

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
      decoration: BoxDecoration(
        color: OmniColors.panel2,
        border: Border.all(color: OmniColors.line),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        child: Row(
          children: [
            TextButton(onPressed: widget.enabled ? _toggle : null, child: Text(_playing ? 'Pause' : 'Play')),
            Text(
              widget.url.isEmpty ? 'No track yet' : '${clock ~/ 60}:${(clock % 60).toString().padLeft(2, '0')}',
              style: const TextStyle(color: OmniColors.muted, fontSize: 12),
            ),
            const Spacer(),
            TextButton(onPressed: widget.enabled ? widget.onUse : null, child: const Text('Use this track')),
          ],
        ),
      ),
    );
  }
}

class _TimelineColumn extends StatelessWidget {
  const _TimelineColumn({required this.board});

  final BoardController board;

  Future<void> _pickStills(String? shotId) async {
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

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              const Text('Timeline', style: TextStyle(color: OmniColors.text, fontWeight: FontWeight.w600)),
              TextButton(onPressed: board.locked ? null : () => _pickStills(null), child: const Text('Upload stills')),
              FilledButton(onPressed: board.locked ? null : board.generateImages, child: const Text('Generate images')),
            ],
          ),
          const SizedBox(height: 4),
          Expanded(
            child: DragTarget<LyricSpan>(
              onAcceptWithDetails: (details) => board.place(details.data),
              builder: (context, candidates, rejected) {
                final hot = candidates.isNotEmpty;
                return DecoratedBox(
                  decoration: BoxDecoration(
                    border: Border.all(color: hot ? OmniColors.cyan : Colors.transparent),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: ListView(
                    children: [
                      Text(board.dropHint, style: const TextStyle(color: OmniColors.muted, fontSize: 12)),
                      for (final shot in board.sections)
                        _ShotCard(
                          board: board,
                          shot: shot,
                          onUpload: () => _pickStills(shot.id),
                        ),
                    ],
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 6),
          SizedBox(height: 92, child: _Reel(board: board)),
        ],
      ),
    );
  }
}

class _ShotCard extends StatelessWidget {
  const _ShotCard({required this.board, required this.shot, required this.onUpload});

  final BoardController board;
  final Shot shot;
  final VoidCallback onUpload;

  @override
  Widget build(BuildContext context) {
    final span = shot.end - shot.start;
    return DragTarget<StillDrag>(
      onAcceptWithDetails: (details) => board.assignStill(shot.id, details.data.id),
      builder: (context, candidates, rejected) {
        return Container(
          margin: const EdgeInsets.only(top: 6),
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(
            color: OmniColors.panel2,
            border: Border.all(color: candidates.isNotEmpty ? OmniColors.cyan : OmniColors.line),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Text(
                    '${formatTime(shot.start)} – ${formatTime(shot.end)}',
                    style: const TextStyle(color: OmniColors.text, fontSize: 12),
                  ),
                  const SizedBox(width: 8),
                  Text('${span.toStringAsFixed(1)}s', style: const TextStyle(color: OmniColors.muted, fontSize: 12)),
                  if (span > 15)
                    const Padding(
                      padding: EdgeInsets.only(left: 6),
                      child: Text('Over 15s', style: TextStyle(color: OmniColors.warn, fontSize: 12)),
                    ),
                  if (board.shotOverlaps(shot))
                    const Padding(
                      padding: EdgeInsets.only(left: 6),
                      child: Text('Overlaps', style: TextStyle(color: OmniColors.warn, fontSize: 12)),
                    ),
                  const Spacer(),
                  TextButton(onPressed: () => board.removeShot(shot.id), child: const Text('Remove')),
                ],
              ),
              Text(shot.lyrics, style: const TextStyle(color: OmniColors.text, fontSize: 13)),
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
                      hint: shot.suggesting ? 'Suggesting a prompt from these lyrics…' : 'What this shot should show',
                      maxLines: 3,
                      onChanged: (value) => board.setPrompt(shot.id, value),
                    ),
                  ),
                ],
              ),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: board.locked ? null : () => board.regenerate(shot.id),
                  child: const Text('Regenerate'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _StillThumb extends StatelessWidget {
  const _StillThumb({required this.board, required this.image, required this.onTap});

  final BoardController board;
  final String image;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final bare = image.split('?').first;
    final child = bare.isEmpty
        ? const Center(child: Text('Drop still', style: TextStyle(color: OmniColors.muted, fontSize: 11)))
        : Image.network(
            board.api.absolute(image),
            fit: BoxFit.cover,
            errorBuilder: (context, error, stack) => const SizedBox.shrink(),
          );
    return InkWell(
      onTap: onTap,
      child: Container(
        width: 96,
        height: 54,
        decoration: BoxDecoration(
          color: Colors.black,
          border: Border.all(color: OmniColors.line),
          borderRadius: BorderRadius.circular(4),
        ),
        clipBehavior: Clip.antiAlias,
        child: child,
      ),
    );
  }
}

class _Reel extends StatelessWidget {
  const _Reel({required this.board});

  final BoardController board;

  @override
  Widget build(BuildContext context) {
    if (board.sections.isEmpty && board.uploads.isEmpty) {
      return const Align(
        alignment: Alignment.centerLeft,
        child: Text(
          'Frames show up here after you drop lyrics on the timeline.',
          style: TextStyle(color: OmniColors.muted, fontSize: 12),
        ),
      );
    }
    return ListView(
      scrollDirection: Axis.horizontal,
      children: [
        for (final shot in board.sections)
          Padding(
            padding: const EdgeInsets.only(right: 6),
            child: Column(
              children: [
                _StillThumb(board: board, image: shot.image, onTap: () {}),
                Text(formatTime(shot.start), style: const TextStyle(color: OmniColors.muted, fontSize: 11)),
              ],
            ),
          ),
        for (final item in board.uploads)
          Padding(
            padding: const EdgeInsets.only(right: 6),
            child: Draggable<StillDrag>(
              data: StillDrag(item.id),
              feedback: const Material(color: Colors.transparent, child: Icon(Icons.image, color: OmniColors.cyan)),
              child: Column(
                children: [
                  _StillThumb(board: board, image: item.url, onTap: () {}),
                  TextButton(onPressed: () => board.deleteUpload(item.id), child: const Text('Remove')),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class StillDrag {
  const StillDrag(this.id);

  final String id;
}

class _MasterColumn extends StatelessWidget {
  const _MasterColumn({required this.board});

  final BoardController board;

  @override
  Widget build(BuildContext context) {
    final quote = board.quote;
    return _Panel(
      child: ListView(
        children: [
          const Text('Master', style: TextStyle(color: OmniColors.text, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          SyncedField(epoch: board.epoch, value: board.feel, label: 'Feel', onChanged: board.setFeel),
          const SizedBox(height: 8),
          const Text('Characters', style: TextStyle(color: OmniColors.muted, fontSize: 12)),
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
              child: TextButton(onPressed: () => board.removeCharacter(i), child: const Text('Remove')),
            ),
          ],
          if (board.cast.length < 8)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(onPressed: board.addCharacter, child: const Text('Add character')),
            ),
          const SizedBox(height: 6),
          SyncedField(
            epoch: board.epoch,
            value: board.masterPrompt,
            label: 'Master prompt',
            maxLines: 4,
            onChanged: board.setMaster,
          ),
          const SizedBox(height: 10),
          FilledButton(
            onPressed: board.locked ? null : board.estimateVideo,
            child: const Text('Generate video'),
          ),
          if (quote != null) ...[
            const SizedBox(height: 6),
            Text(quote.note, style: const TextStyle(color: OmniColors.text, fontSize: 12)),
            const SizedBox(height: 4),
            Row(
              children: [
                FilledButton(onPressed: board.confirmVideo, child: Text(quote.label)),
                TextButton(onPressed: board.cancelVideo, child: const Text('Cancel')),
              ],
            ),
          ],
          if (board.videoNote.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(board.videoNote, style: const TextStyle(color: OmniColors.muted, fontSize: 12)),
            ),
          if (board.videoSrc.isNotEmpty) ...[
            const SizedBox(height: 8),
            _Clip(url: board.api.absolute(board.videoSrc)),
          ],
        ],
      ),
    );
  }
}

class _Clip extends StatefulWidget {
  const _Clip({required this.url});

  final String url;

  @override
  State<_Clip> createState() => _ClipState();
}

class _ClipState extends State<_Clip> {
  VideoPlayerController? _controller;
  String _error = '';

  @override
  void initState() {
    super.initState();
    unawaited(_load(widget.url));
  }

  @override
  void didUpdateWidget(_Clip old) {
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
      return Text(_error, style: const TextStyle(color: OmniColors.warn, fontSize: 12));
    }
    if (controller == null || !controller.value.isInitialized) {
      return const SizedBox(height: 24, child: Text('Loading video…', style: TextStyle(color: OmniColors.muted, fontSize: 12)));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AspectRatio(aspectRatio: controller.value.aspectRatio, child: VideoPlayer(controller)),
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
    _focus = FocusNode();
  }

  @override
  void didUpdateWidget(SyncedField old) {
    super.didUpdateWidget(old);
    final external = widget.epoch != old.epoch || (!_focus.hasFocus && widget.value != _controller.text);
    if (external && widget.value != _controller.text) {
      _controller.value = TextEditingValue(
        text: widget.value,
        selection: TextSelection.collapsed(offset: widget.value.length),
      );
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
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
                child: Text(widget.note, style: const TextStyle(color: OmniColors.muted, fontSize: 12)),
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
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(context, _field.text), child: const Text('Open')),
      ],
    );
  }
}
