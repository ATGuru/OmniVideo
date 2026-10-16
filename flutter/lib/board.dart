import 'dart:async';

import 'package:flutter/foundation.dart';

import 'api.dart';
import 'placement.dart';
import 'settings.dart';

class Character {
  Character({this.name = '', this.look = ''});

  String name;
  String look;

  Map<String, String> toJson() => {'name': name, 'look': look};
}

class Shot {
  Shot({
    required this.id,
    required this.start,
    required this.end,
    required this.lyrics,
    this.prompt = '',
    this.image = '',
    this.sent = '',
    this.source = '',
  });

  final String id;
  double start;
  double end;
  String lyrics;
  String prompt;
  String image;
  String sent;
  String source;
  bool suggesting = false;
  bool promptEdited = false;

  Map<String, dynamic> toJson() => {
        'id': id,
        'start': start,
        'end': end,
        'lyrics': lyrics,
        'prompt': prompt,
        'image': image.split('?').first,
        'sent': sent,
        'source': source,
      };
}

class UploadStill {
  UploadStill({required this.id, required this.url, required this.name});

  final String id;
  final String url;
  final String name;
}

class GeneratedTrack {
  GeneratedTrack({required this.url, required this.name, required this.lyrics, required this.duration});

  final String url;
  final String name;
  final String lyrics;
  final double duration;
}

class VideoQuote {
  VideoQuote({required this.cost, required this.note});

  final double cost;
  final String note;

  String get label => cost > 0 ? 'Generate for \$${cost.toStringAsFixed(2)}' : 'Assemble video';
}

/// Board state for the landscape client. Generation stays on the desktop API.
class BoardController extends ChangeNotifier {
  BoardController({SettingsStore? settings, OmniApi? api})
      : _settings = settings ?? PrefsSettings(),
        api = api ?? OmniApi('') {
    baseUrl = this.api.baseUrl;
    unawaited(_loadSettings());
  }

  final SettingsStore _settings;
  OmniApi api;

  String baseUrl = '';
  String status = '';
  String tab = 'transcribe';
  int epoch = 0;

  String projectId = '';
  String projectName = '';
  String songName = '';
  String songPath = '';

  String feel = '';
  String masterPrompt = '';
  List<Character> cast = [Character()];

  List<LyricLine> lines = [];
  String lyricsSource = '';
  int? anchor;
  List<int> selected = [];

  List<Shot> sections = [];
  List<UploadStill> uploads = [];
  int seq = 1;

  String style = '';
  String draftLyrics = '';
  int length = 30;
  GeneratedTrack? generated;

  String videoUrl = '';
  int videoStamp = 0;
  VideoQuote? quote;
  bool videoRunning = false;
  String videoNote = '';

  bool busy = false;
  bool audioJob = false;

  List<ProjectName> projects = [];
  String? cloudRoot;
  String listNote = '';

  bool _disposed = false;
  int _videoToken = 0;

  bool get locked => busy || audioJob || videoRunning;
  bool get hasProject => projectId.isNotEmpty;
  String get title => projectName.isNotEmpty ? projectName : (songName.isNotEmpty ? songName : 'No project');

  String get lyricNote {
    if (lyricsSource == 'written' && lines.isNotEmpty) {
      return 'These are the lyrics used to generate the track. Times are spread across its length.';
    }
    if (lyricsSource == 'written') return 'Instrumental track. No lyrics were written for it.';
    if (lines.isEmpty) {
      return songName.isNotEmpty ? 'Song loaded. Transcribe to fill the lyrics.' : 'Load a song, then transcribe.';
    }
    return '${lines.length} lines from the song. Edit a line to correct the words.';
  }

  String get dropHint => sections.isEmpty
      ? 'Drop a lyric selection here'
      : 'Drop more lyrics here. Each scene lands at its own time.';

  String get videoSrc => videoUrl.isEmpty ? '' : '$videoUrl?t=$videoStamp';

  bool lineIsUsed(LyricLine line) {
    return lineUsed(line, [for (final shot in sections) TimeSpan(shot.start, shot.end)]);
  }

  bool shotOverlaps(Shot shot) {
    return rangeOverlaps(
      shot.start,
      shot.end,
      shot.id,
      [for (final other in sections) (id: other.id, start: other.start, end: other.end)],
    );
  }

  Future<void> _loadSettings() async {
    final saved = normalizeBase(await _settings.loadBaseUrl());
    if (_disposed || saved == null || saved == baseUrl) return;
    _swapApi(saved);
    _notify();
  }

  void _swapApi(String url) {
    if (api.baseUrl == url) {
      baseUrl = url;
      return;
    }
    final next = OmniApi(url);
    api.close();
    api = next;
    baseUrl = url;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _bump() {
    epoch += 1;
    _notify();
  }

  void setStatus(String text) {
    status = text;
    _notify();
  }

  void showTab(String name) {
    tab = name;
    _notify();
  }

  Future<void> setBaseUrl(String raw) async {
    final next = normalizeBase(raw);
    if (next == null) {
      setStatus('Enter a backend address such as http://<tower>:8080');
      return;
    }
    _swapApi(next);
    await _settings.saveBaseUrl(next);
    _notify();
  }

  Future<void> connect() async {
    try {
      final data = await api.get('/api/settings', timeout: OmniApi.settingsTimeout);
      final hasKey = data['has_key'] == true;
      setStatus(hasKey ? 'Backend connected.' : 'Backend connected. No API key on that machine.');
    } on OmniException catch (err) {
      setStatus(err.message);
    }
  }

  Future<void> refreshProjects() async {
    try {
      final data = await api.get('/api/projects', timeout: OmniApi.settingsTimeout);
      final rows = data['projects'];
      projects = [
        if (rows is List)
          for (final row in rows)
            if (row is Map) ProjectName(id: '${row['id'] ?? row['name'] ?? ''}', name: '${row['name'] ?? row['id'] ?? ''}'),
      ].where((row) => row.id.isNotEmpty).toList();
      final cloud = data['cloud_root'];
      cloudRoot = cloud is String && cloud.isNotEmpty ? cloud : null;
      listNote = cloudRoot == null
          ? 'Named projects are on the desktop. Start the server with OMNIVIDEO_PROJECTS so the phone file app can browse them.'
          : 'Phone file path: $cloudRoot/<name>';
      _notify();
    } on OmniException catch (err) {
      projects = [];
      cloudRoot = null;
      listNote = err.statusCode == 404
          ? 'This server has no project list. Type the project name.'
          : err.message;
      _notify();
    }
  }

  void _applyTimeline(Map<String, dynamic> timeline) {
    projectId = '${timeline['id'] ?? projectId}';
    final named = '${timeline['name'] ?? ''}';
    if (named.isNotEmpty) projectName = named;
    songName = '${timeline['song'] ?? ''}';
    songPath = '${timeline['song_path'] ?? ''}';
    feel = '${timeline['feel'] ?? timeline['global_style'] ?? ''}';
    masterPrompt = '${timeline['master_prompt'] ?? ''}';
    final people = timeline['characters'];
    cast = [
      if (people is List)
        for (final person in people)
          if (person is Map) Character(name: '${person['name'] ?? ''}', look: '${person['look'] ?? ''}'),
    ];
    if (cast.isEmpty) cast = [Character()];
    lyricsSource = '${timeline['lyrics_source'] ?? ''}';
    final lyricRows = timeline['lyrics'];
    lines = [
      if (lyricRows is List)
        for (final row in lyricRows)
          if (row is Map && '${row['text'] ?? ''}'.trim().isNotEmpty)
            LyricLine(
              start: _asDouble(row['start']),
              end: _asDouble(row['end']),
              text: '${row['text']}'.trim(),
            ),
    ];
    final shots = timeline['sections'];
    sections = [
      if (shots is List)
        for (final row in shots)
          if (row is Map && '${row['id'] ?? ''}'.isNotEmpty)
            Shot(
              id: '${row['id']}',
              start: _asDouble(row['start']),
              end: _asDouble(row['end']),
              lyrics: '${row['lyrics'] ?? ''}',
              prompt: '${row['prompt'] ?? ''}',
              image: '${row['image'] ?? ''}'.split('?').first,
              sent: '${row['sent'] ?? ''}',
              source: '${row['source'] ?? ''}',
            ),
    ];
    final tray = timeline['uploads'];
    uploads = [
      if (tray is List)
        for (final row in tray)
          if (row is Map && '${row['id'] ?? ''}'.isNotEmpty)
            UploadStill(
              id: '${row['id']}',
              url: '${row['url'] ?? ''}'.split('?').first,
              name: '${row['name'] ?? ''}',
            ),
    ];
    videoUrl = '${timeline['video'] ?? ''}'.split('?').first;
    videoStamp = videoUrl.isEmpty ? 0 : DateTime.now().millisecondsSinceEpoch;
    quote = null;
    selected = [];
    anchor = null;
    seq = 1;
    for (final shot in sections) {
      final match = RegExp(r'^s(\d+)$').firstMatch(shot.id);
      if (match != null) {
        final number = int.tryParse(match.group(1) ?? '') ?? 0;
        if (number > seq) seq = number;
      }
    }
  }

  void _clearBoard(String name, String id) {
    projectName = name;
    projectId = id;
    songName = '';
    songPath = '';
    lines = [];
    lyricsSource = '';
    selected = [];
    anchor = null;
    sections = [];
    uploads = [];
    cast = [Character()];
    seq = 1;
    feel = '';
    masterPrompt = '';
    videoUrl = '';
    videoStamp = 0;
    quote = null;
    videoNote = '';
    videoRunning = false;
    _videoToken += 1;
    tab = 'transcribe';
    epoch += 1;
  }

  Future<void> createProject(String rawName) async {
    final name = rawName.replaceAll(RegExp(r'\s+'), ' ').trim();
    if (name.isEmpty) {
      setStatus('Type a project name.');
      return;
    }
    try {
      final data = await api.postJson('/api/project/new', {'name': name});
      final id = '${data['project_id'] ?? name}';
      final created = '${data['name'] ?? name}';
      _clearBoard(created, id);
      setStatus('Project "$created" is ready. Stills save in its OmniVideo/Projects folder.');
    } on OmniException catch (err) {
      setStatus(err.message);
    }
  }

  Future<void> openProject(String rawName) async {
    final name = rawName.replaceAll(RegExp(r'\s+'), ' ').trim();
    if (name.isEmpty) {
      setStatus('Type a project name.');
      return;
    }
    try {
      final data = await api.get(OmniApi.projectPath(name));
      _applyTimeline(data);
      if (projectName.isEmpty) projectName = name;
      projectId = name;
      epoch += 1;
      tab = 'transcribe';
      _notify();
      setStatus('Opened $name.');
      await _resumeVideo();
    } on OmniException catch (err) {
      setStatus(err.message);
    }
  }

  Map<String, dynamic> saveBody() {
    return {
      'id': projectId,
      'name': projectName,
      'song': songName,
      'song_path': songPath,
      'global_style': feel,
      'feel': feel,
      'master_prompt': masterPrompt,
      'characters': [
        for (final person in cast)
          if (person.name.trim().isNotEmpty || person.look.trim().isNotEmpty) person.toJson(),
      ],
      'lyrics_source': lyricsSource,
      'lyrics': [
        for (final line in lines) {'start': line.start, 'end': line.end, 'text': line.text},
      ],
      'sections': [for (final shot in sections) shot.toJson()],
      'video': videoUrl,
      'uploads': [
        for (final item in uploads) {'id': item.id, 'url': item.url.split('?').first, 'name': item.name},
      ],
    };
  }

  Future<bool> save({bool quiet = false}) async {
    if (!hasProject) {
      setStatus('Create a project, or load a song, before saving.');
      return false;
    }
    try {
      final existing = await api.get(OmniApi.projectPath(projectId));
      final body = saveBody();
      body['song'] = '${existing['song'] ?? songName}';
      body['song_path'] = '${existing['song_path'] ?? songPath}';
      songName = '${body['song']}';
      songPath = '${body['song_path']}';
      await api.postJson(OmniApi.projectPath(projectId, '/timeline'), body);
      if (quiet) {
        _notify();
      } else {
        setStatus('Saved.');
      }
      return true;
    } on OmniException catch (err) {
      setStatus(err.message);
      return false;
    }
  }

  Future<void> uploadSong(List<int> bytes, String filename) async {
    if (!hasProject) {
      setStatus('Create or open a project first so the song is saved in OmniVideo/Projects.');
      return;
    }
    if (bytes.length < 1000) {
      setStatus('That file looks empty.');
      return;
    }
    setStatus('Loading song…');
    try {
      await api.postFile(OmniApi.projectPath(projectId, '/song'), 'file', bytes, filename);
      final timeline = await api.get(OmniApi.projectPath(projectId));
      songPath = '${timeline['song_path'] ?? ''}';
      songName = '${timeline['song'] ?? filename}';
      lines = [];
      lyricsSource = '';
      selected = [];
      anchor = null;
      videoUrl = '';
      videoStamp = 0;
      quote = null;
      videoNote = '';
      _videoToken += 1;
      videoRunning = false;
      epoch += 1;
      setStatus('Song loaded. Transcribe to fill the lyrics.');
    } on OmniException catch (err) {
      setStatus(err.message);
    }
  }

  Future<void> transcribe() async {
    if (locked) return;
    if (!hasProject || songName.isEmpty) {
      setStatus('Load a song before transcribing.');
      return;
    }
    busy = true;
    setStatus('Transcribing on the desktop. A full song can take several minutes.');
    try {
      final data = await api.postJson(
        OmniApi.projectPath(projectId, '/transcribe'),
        {},
        timeout: OmniApi.transcribeTimeout,
      );
      final rows = data['lines'];
      final next = <LyricLine>[
        if (rows is List)
          for (final row in rows)
            if (row is Map && '${row['text'] ?? ''}'.trim().isNotEmpty)
              LyricLine(
                start: _asDouble(row['start']),
                end: _asDouble(row['end']),
                text: '${row['text']}'.trim(),
              ),
      ];
      if (next.isEmpty) throw OmniException('Whisper returned no lines.');
      lines = next;
      lyricsSource = 'song';
      selected = [];
      anchor = null;
      epoch += 1;
      setStatus('Transcription ready. Select lines and drag them onto the timeline.');
    } on OmniException catch (err) {
      setStatus(err.message);
    } finally {
      busy = false;
      _notify();
    }
  }

  void selectLine(int index) {
    anchor = index;
    selected = [index];
    _notify();
  }

  void extendSelection(int index) {
    final from = anchor ?? index;
    anchor ??= index;
    final lo = from < index ? from : index;
    final hi = from > index ? from : index;
    selected = [for (var i = lo; i <= hi; i++) i];
    _notify();
  }

  LyricSpan? payloadFor(int index) {
    if (selected.contains(index)) return selectionPayload(lines, selected);
    if (index < 0 || index >= lines.length) return null;
    final line = lines[index];
    return LyricSpan(start: line.start, end: line.end, lyrics: line.text);
  }

  void editLine(int index, String raw) {
    if (index < 0 || index >= lines.length) return;
    final next = raw.replaceAll(RegExp(r'\s+'), ' ').trim();
    final prev = lines[index].text;
    if (next.isEmpty || next == prev) return;
    lines[index] = lines[index].copyWith(text: next);
    var shots = 0;
    for (final section in sections) {
      if (!section.lyrics.contains(prev)) continue;
      final updated = replaceWholeLine(section.lyrics, prev, next);
      if (updated == section.lyrics) continue;
      section.lyrics = updated;
      shots += 1;
    }
    setStatus(shots > 0 ? 'Lyric updated. Shots that used that line now show the new words.' : 'Lyric updated.');
  }

  Future<void> place(LyricSpan payload) async {
    if (alreadyPlaced(payload, [
      for (final shot in sections) (lyrics: shot.lyrics, start: shot.start, end: shot.end),
    ])) {
      setStatus('That scene is already on the timeline.');
      return;
    }
    final fit = fittingSpan(payload.start, payload.end, [for (final shot in sections) TimeSpan(shot.start, shot.end)]);
    if (fit == null) {
      setStatus('That moment is already a shot.');
      return;
    }
    final clipped = fit.start > payload.start + 0.05 || fit.end < payload.end - 0.05;
    seq += 1;
    final shot = Shot(id: 's$seq', start: fit.start, end: fit.end, lyrics: payload.lyrics, prompt: '');
    shot.suggesting = true;
    sections = [...sections, shot]..sort((a, b) => a.start != b.start ? a.start.compareTo(b.start) : a.end.compareTo(b.end));
    final when = '${formatTime(shot.start)} – ${formatTime(shot.end)}';
    status = clipped
        ? 'Placed at $when, where the timeline had room. Suggesting a prompt.'
        : 'Placed at $when. Suggesting a prompt.';
    _notify();
    await _suggest(shot);
  }

  Future<void> _suggest(Shot shot) async {
    try {
      final data = await api.postJson('/api/suggest-prompt', {
        'lyrics': shot.lyrics,
        'start': shot.start,
        'end': shot.end,
        'feel': feel,
        'master_prompt': masterPrompt,
        'characters': [
          for (final person in cast)
            if (person.name.trim().isNotEmpty || person.look.trim().isNotEmpty) person.toJson(),
        ],
      });
      final suggestion = '${data['prompt'] ?? ''}'.trim();
      if (suggestion.isEmpty) throw OmniException('No prompt came back.');
      if (!shot.promptEdited) shot.prompt = suggestion;
    } on OmniException catch (err) {
      if (!shot.promptEdited) status = err.message;
    } finally {
      shot.suggesting = false;
      if (shot.prompt.isNotEmpty && !shot.promptEdited) {
        status = 'Suggested a prompt. Edit it, then generate.';
      } else if (shot.promptEdited) {
        status = 'Kept what you typed. Generate when it looks right.';
      }
      _notify();
    }
  }

  void removeShot(String id) {
    sections = [for (final shot in sections) if (shot.id != id) shot];
    _notify();
  }

  void setPrompt(String id, String value) {
    for (final shot in sections) {
      if (shot.id != id) continue;
      shot.prompt = value;
      shot.promptEdited = true;
      shot.suggesting = false;
    }
    _notify();
  }

  void setFeel(String value) {
    feel = value;
    _notify();
  }

  void setMaster(String value) {
    masterPrompt = value;
    _notify();
  }

  void setStyle(String value) {
    style = value;
    _notify();
  }

  void setDraftLyrics(String value) {
    draftLyrics = value;
    _notify();
  }

  void setLength(int value) {
    length = value;
    _notify();
  }

  void setCharacter(int index, {String? name, String? look}) {
    if (index < 0 || index >= cast.length) return;
    if (name != null) cast[index].name = name;
    if (look != null) cast[index].look = look;
    _notify();
  }

  void addCharacter() {
    if (cast.length >= 8) return;
    cast = [...cast, Character()];
    _bump();
  }

  void removeCharacter(int index) {
    cast = [for (var i = 0; i < cast.length; i++) if (i != index) cast[i]];
    if (cast.isEmpty) cast = [Character()];
    _bump();
  }

  Future<void> suggestLyrics() async {
    if (audioJob) return;
    if (style.trim().length < 2) {
      setStatus('Write a style or mood first.');
      return;
    }
    setStatus('Suggesting lyrics…');
    try {
      final data = await api.postJson('/api/suggest-lyrics', {'prompt': style.trim()});
      draftLyrics = '${data['lyrics'] ?? ''}';
      epoch += 1;
      setStatus('Lyrics suggested. Edit them, then generate.');
    } on OmniException catch (err) {
      setStatus(err.message);
    }
  }

  Future<void> generateAudio() async {
    if (audioJob) return;
    if (style.trim().length < 2) {
      setStatus('Write a style or mood first.');
      return;
    }
    audioJob = true;
    setStatus('Generating audio on the desktop. This can take a few minutes.');
    try {
      final data = await api.postJson(
        '/api/generate-audio',
        {'prompt': style.trim(), 'lyrics': draftLyrics.trim(), 'duration': length},
        timeout: OmniApi.audioTimeout,
      );
      generated = GeneratedTrack(
        url: '${data['url'] ?? ''}',
        name: '${data['name'] ?? 'generated.mp3'}',
        lyrics: data['lyrics'] is String ? data['lyrics'] as String : draftLyrics.trim(),
        duration: _asDouble(data['duration'], fallback: length.toDouble()),
      );
      setStatus('${data['status'] ?? 'Track ready. Play it, or use it as the song.'}');
    } on OmniException catch (err) {
      setStatus(err.message);
    } finally {
      audioJob = false;
      _notify();
    }
  }

  Future<void> useTrack() async {
    final track = generated;
    if (audioJob) return;
    if (track == null || track.url.isEmpty) {
      setStatus('Generate a track first.');
      return;
    }
    if (!hasProject) {
      setStatus('Create or open a project first so the song is saved in OmniVideo/Projects.');
      return;
    }
    setStatus('Loading the generated track…');
    try {
      final bytes = await api.getBytes(track.url, timeout: OmniApi.audioTimeout);
      await api.postFile(OmniApi.projectPath(projectId, '/song'), 'file', bytes, track.name);
      final timeline = await api.get(OmniApi.projectPath(projectId));
      songPath = '${timeline['song_path'] ?? ''}';
      songName = '${timeline['song'] ?? track.name}';
      lines = linesFromLyrics(track.lyrics, track.duration);
      lyricsSource = 'written';
      selected = [];
      anchor = null;
      videoUrl = '';
      videoStamp = 0;
      quote = null;
      videoNote = '';
      tab = 'transcribe';
      epoch += 1;
      setStatus(lines.isEmpty
          ? 'Track loaded. No lyrics were written for it.'
          : 'Track loaded. The lyrics you wrote are on the left.');
    } on OmniException catch (err) {
      setStatus(err.message);
    }
  }

  Future<void> uploadStills(List<StillFile> files, {String? shotId}) async {
    if (!hasProject) {
      setStatus('Create or open a project before uploading stills.');
      return;
    }
    final accepted = [
      for (final file in files)
        if (_isStillName(file.filename)) file,
    ];
    if (accepted.isEmpty) {
      setStatus('Use a JPEG, PNG, or WebP.');
      return;
    }
    setStatus(accepted.length == 1 ? 'Uploading 1 still…' : 'Uploading ${accepted.length} stills…');
    try {
      final data = await api.postFiles(OmniApi.projectPath(projectId, '/stills'), 'files', accepted);
      final rows = data['stills'];
      final saved = <UploadStill>[
        if (rows is List)
          for (final row in rows)
            if (row is Map)
              UploadStill(
                id: '${row['id'] ?? ''}',
                url: '${row['url'] ?? ''}',
                name: '${row['name'] ?? ''}',
              ),
      ].where((item) => item.id.isNotEmpty).toList();
      if (saved.isEmpty) throw OmniException('No stills were saved.');
      Shot? target;
      for (final shot in sections) {
        if (shot.id == shotId) target = shot;
      }
      if (target != null) {
        final first = saved.first;
        final rest = saved.skip(1);
        uploads = [...uploads, ...rest];
        _placeStill(target, first);
        if (rest.isNotEmpty) {
          setStatus('Placed the first still. Drag the others onto their frames.');
        }
      } else {
        uploads = [...uploads, ...saved];
        setStatus(saved.length == 1 ? 'Still ready. Drag it onto a frame.' : '${saved.length} stills ready. Drag each one onto a frame.');
      }
    } on OmniException catch (err) {
      setStatus(err.message);
    }
  }

  void assignStill(String shotId, String stillId) {
    Shot? shot;
    UploadStill? item;
    for (final section in sections) {
      if (section.id == shotId) shot = section;
    }
    for (final upload in uploads) {
      if (upload.id == stillId) item = upload;
    }
    if (shot == null || item == null) {
      setStatus('Drop the still on the frame it belongs to.');
      return;
    }
    _placeStill(shot, item);
  }

  void _placeStill(Shot shot, UploadStill item) {
    shot.image = item.url.split('?').first;
    shot.source = 'upload';
    shot.sent = '';
    uploads = [for (final other in uploads) if (other.id != item.id) other];
    setStatus('Placed ${item.name.isEmpty ? 'still' : item.name} on ${formatTime(shot.start)} – ${formatTime(shot.end)}.');
  }

  Future<void> deleteUpload(String id) async {
    UploadStill? item;
    for (final upload in uploads) {
      if (upload.id == id) item = upload;
    }
    if (item == null || !hasProject) return;
    final name = item.url.split('?').first.split('/').last;
    try {
      await api.delete(OmniApi.projectPath(projectId, '/stills/${Uri.encodeComponent(name)}'));
      uploads = [for (final other in uploads) if (other.id != id) other];
      setStatus('Removed the unused still.');
    } on OmniException catch (err) {
      setStatus(err.message);
    }
  }

  Future<void> generateImages() async {
    if (locked) return;
    if (!hasProject) {
      setStatus('Open a project first. Each image is \$0.02.');
      return;
    }
    if (sections.isEmpty) {
      setStatus('Add shots to the timeline first. Each image is \$0.02.');
      return;
    }
    final missing = [for (final shot in sections) if (shot.image.isEmpty) shot];
    if (missing.isEmpty) {
      setStatus('Every shot already has an image. Regenerate replaces one, at \$0.02.');
      return;
    }
    await _generateList(missing, 'Generating');
  }

  Future<void> regenerate(String id) async {
    if (locked) return;
    Shot? shot;
    for (final section in sections) {
      if (section.id == id) shot = section;
    }
    if (shot == null) return;
    if (!hasProject) {
      setStatus('Open a project first. Each image is \$0.02.');
      return;
    }
    await _generateList([shot], 'Regenerating this image');
  }

  Future<void> _generateList(List<Shot> list, String label) async {
    busy = true;
    var spent = 0.0;
    _notify();
    try {
      final saved = await save(quiet: true);
      if (!saved) return;
      for (var i = 0; i < list.length; i++) {
        if (_disposed) return;
        setStatus('$label ${i + 1} of ${list.length} · \$0.02 each');
        final shot = list[i];
        final data = await api.postJson(
          OmniApi.projectPath(projectId, '/sections/${Uri.encodeComponent(shot.id)}/image'),
          {
            'prompt': shot.prompt,
            'lyrics': shot.lyrics,
            'start': shot.start,
            'end': shot.end,
            'feel': feel,
            'master_prompt': masterPrompt,
            'characters': [
              for (final person in cast)
                if (person.name.trim().isNotEmpty || person.look.trim().isNotEmpty) person.toJson(),
            ],
          },
          timeout: OmniApi.imageTimeout,
        );
        final url = '${data['url'] ?? ''}';
        shot.image = url.isEmpty ? shot.image : '$url?t=${DateTime.now().millisecondsSinceEpoch}';
        shot.sent = '${data['prompt'] ?? ''}';
        shot.source = 'generated';
        spent += _asDouble(data['cost'], fallback: 0.02);
        _notify();
      }
      final noun = list.length == 1 ? 'image' : 'images';
      setStatus('Ready. ${list.length} $noun, \$${spent.toStringAsFixed(2)}.');
    } on OmniException catch (err) {
      setStatus(err.message);
    } finally {
      busy = false;
      _notify();
    }
  }

  Map<String, dynamic> _videoBody() {
    return {
      'feel': feel,
      'master_prompt': masterPrompt,
      'characters': [
        for (final person in cast)
          if (person.name.trim().isNotEmpty || person.look.trim().isNotEmpty) person.toJson(),
      ],
      'sections': [
        for (final shot in sections)
          {
            'id': shot.id,
            'start': shot.start,
            'end': shot.end,
            'lyrics': shot.lyrics,
            'prompt': shot.prompt,
            'image': shot.image.split('?').first,
          },
      ],
    };
  }

  Future<void> estimateVideo() async {
    if (locked) return;
    if (!hasProject || songName.isEmpty) {
      setStatus('Load a song first.');
      return;
    }
    if (sections.isEmpty) {
      setStatus('Add shots and images first.');
      return;
    }
    final missing = sections.where((shot) => shot.image.isEmpty).length;
    if (missing > 0) {
      final noun = missing == 1 ? 'is' : 'are';
      setStatus('Every shot needs an image first. $missing $noun still empty.');
      return;
    }
    quote = null;
    videoNote = 'Estimating the cost…';
    setStatus('Estimating the cost…');
    try {
      final saved = await save(quiet: true);
      if (!saved) return;
      final data = await api.postJson(OmniApi.projectPath(projectId, '/video/estimate'), _videoBody());
      quote = VideoQuote(cost: _asDouble(data['cost']), note: '${data['note'] ?? ''}');
      videoNote = '';
      setStatus('Check the cost, then confirm.');
    } on OmniException catch (err) {
      videoNote = err.message;
      setStatus(err.message);
    }
  }

  void cancelVideo() {
    quote = null;
    videoNote = '';
    setStatus('Cancelled. Nothing was generated.');
  }

  Future<void> confirmVideo() async {
    final current = quote;
    if (locked || current == null || !hasProject) return;
    final project = projectId;
    videoRunning = true;
    quote = null;
    videoNote = 'Starting the video.';
    setStatus('Starting the video.');
    try {
      final body = _videoBody();
      body['confirm'] = true;
      body['cost'] = current.cost;
      final data = await api.postJson(OmniApi.projectPath(project, '/video'), body);
      videoNote = '${data['step'] ?? 'Starting the video.'}';
      status = videoNote;
      _notify();
      _schedulePoll(project);
    } on OmniException catch (err) {
      videoRunning = false;
      videoNote = err.message;
      setStatus(err.message);
    }
  }

  Future<void> _resumeVideo() async {
    if (!hasProject) return;
    try {
      final data = await api.get(OmniApi.projectPath(projectId, '/video/status'));
      if (_disposed) return;
      final state = '${data['status'] ?? ''}';
      if (state == 'running') {
        videoRunning = true;
        videoNote = '${data['step'] ?? 'Generating the video.'}';
        _notify();
        _schedulePoll(projectId);
        return;
      }
      if (state == 'error' && '${data['error'] ?? ''}'.isNotEmpty) {
        videoNote = '${data['error']}';
      }
      final url = '${data['url'] ?? ''}'.split('?').first;
      if (url.isNotEmpty) {
        videoUrl = url;
        videoStamp = DateTime.now().millisecondsSinceEpoch;
      }
      _notify();
    } on OmniException {
      _notify();
    }
  }

  void _schedulePoll(String project) {
    final token = ++_videoToken;
    unawaited(_poll(project, token));
  }

  Future<void> _poll(String project, int token) async {
    await Future<void>.delayed(const Duration(seconds: 2));
    if (_disposed || token != _videoToken || projectId != project) return;
    try {
      final data = await api.get(OmniApi.projectPath(project, '/video/status'));
      if (_disposed || token != _videoToken || projectId != project) return;
      final state = '${data['status'] ?? ''}';
      if (state == 'running') {
        videoNote = '${data['step'] ?? 'Generating the video.'}';
        status = videoNote;
        _notify();
        await _poll(project, token);
        return;
      }
      videoRunning = false;
      if (state == 'done' && '${data['url'] ?? ''}'.isNotEmpty) {
        videoUrl = '${data['url']}'.split('?').first;
        videoStamp = DateTime.now().millisecondsSinceEpoch;
        videoNote = '${data['step'] ?? 'Video ready.'}';
        setStatus(videoNote);
        return;
      }
      if (state == 'error') {
        videoNote = '${data['error'] ?? 'Video failed.'}';
        setStatus(videoNote);
        return;
      }
      final url = '${data['url'] ?? ''}'.split('?').first;
      if (url.isNotEmpty) {
        videoUrl = url;
        videoStamp = DateTime.now().millisecondsSinceEpoch;
      }
      _notify();
    } on OmniException catch (err) {
      videoRunning = false;
      setStatus(err.message);
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _videoToken += 1;
    api.close();
    super.dispose();
  }
}

double _asDouble(Object? value, {double fallback = 0}) {
  if (value is num) return value.toDouble();
  return double.tryParse('$value') ?? fallback;
}

bool _isStillName(String name) {
  return RegExp(r'\.(jpe?g|png|webp)$', caseSensitive: false).hasMatch(name);
}
