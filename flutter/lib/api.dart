import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

/// Desktop OmniVideo board. Same Tailscale address the file app uses.
const String kOmniVideoBackend = 'http://100.67.76.16:8080';

/// Same board, other port. Cleartext port 8080 is often answered with HTTP 408
/// by a phone proxy before the packet reaches the desktop.
const String kOmniVideoBackendFallback = 'http://100.67.76.16:18080';

class OmniException implements Exception {
  OmniException(this.message, {this.statusCode, this.needed});

  final String message;
  final int? statusCode;

  /// -1 when the sheet should be fit to the lyrics instead of a preset length.
  final int? needed;

  @override
  String toString() => message;
}

class ProjectName {
  const ProjectName({required this.id, required this.name});

  final String id;
  final String name;
}

class ProjectList {
  const ProjectList({required this.projects, this.cloudRoot});

  final List<ProjectName> projects;
  final String? cloudRoot;
}

class StillFile {
  const StillFile({required this.bytes, required this.filename});

  final List<int> bytes;
  final String filename;
}

/// Talks only to the desktop OmniVideo HTTP API. No model calls happen here.
class OmniApi {
  OmniApi(String baseUrl, {http.Client? client})
      : _base = _trim(baseUrl),
        _client = client ?? _directClient(),
        _ownsClient = client == null;

  String _base;
  bool _usingFallback = false;
  final http.Client _client;
  final bool _ownsClient;

  String get baseUrl => _base;

  static http.Client _directClient() {
    final inner = HttpClient()
      ..connectionTimeout = const Duration(seconds: 20)
      ..idleTimeout = const Duration(seconds: 2)
      ..findProxy = (_) => 'DIRECT';
    return IOClient(inner);
  }

  static const Duration settingsTimeout = Duration(seconds: 15);
  static const Duration shortTimeout = Duration(seconds: 60);
  static const Duration imageTimeout = Duration(minutes: 2);
  static const Duration transcribeTimeout = Duration(minutes: 20);
  static const Duration audioTimeout = Duration(minutes: 45);

  static String _trim(String baseUrl) {
    var text = baseUrl.trim();
    if (text.endsWith('/')) text = text.substring(0, text.length - 1);
    return text;
  }

  void close() {
    if (_ownsClient) _client.close();
  }

  Uri uri(String path) {
    if (baseUrl.isEmpty) {
      throw OmniException('The backend address is missing.');
    }
    return Uri.parse('$baseUrl$path');
  }

  String absolute(String url) {
    if (url.isEmpty) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    final path = url.startsWith('/') ? url : '/$url';
    return '$baseUrl$path';
  }

  Future<Map<String, dynamic>> get(String path, {Duration timeout = shortTimeout}) {
    return _attempt(() => _send(() => _client.get(uri(path), headers: _close).timeout(timeout)));
  }

  Future<Map<String, dynamic>> postJson(
    String path,
    Map<String, dynamic> body, {
    Duration timeout = shortTimeout,
  }) {
    return _attempt(
      () => _send(
        () => _client
            .post(
              uri(path),
              headers: {'Content-Type': 'application/json', 'Connection': 'close'},
              body: jsonEncode(body),
            )
            .timeout(timeout),
      ),
    );
  }

  Future<Map<String, dynamic>> delete(String path) {
    return _attempt(() => _send(() => _client.delete(uri(path), headers: _close).timeout(shortTimeout)));
  }

  static const _close = {'Connection': 'close'};

  Future<T> _attempt<T>(Future<T> Function() run) async {
    try {
      return await run();
    } on OmniException catch (err) {
      if (_usingFallback || _base != _trim(kOmniVideoBackend) || !_worthRetry(err)) rethrow;
      _usingFallback = true;
      _base = _trim(kOmniVideoBackendFallback);
      return await run();
    }
  }

  static bool _worthRetry(OmniException err) {
    if (err.statusCode == 408) return true;
    return err.statusCode == null && err.message.startsWith('Could not reach');
  }

  Future<List<int>> getBytes(String path, {Duration timeout = shortTimeout}) {
    return _attempt(() => _getBytes(path, timeout));
  }

  Future<List<int>> _getBytes(String path, Duration timeout) async {
    final http.Response res;
    try {
      res = await _client.get(uri(path), headers: _close).timeout(timeout);
    } on TimeoutException {
      throw OmniException('The backend took too long.');
    } on http.ClientException catch (err) {
      throw OmniException(reachError(err.message));
    } on SocketException catch (err) {
      throw OmniException(reachError(err.message));
    }
    if (res.statusCode >= 400) throw exceptionFrom(res);
    return res.bodyBytes;
  }

  Future<Map<String, dynamic>> postFile(
    String path,
    String field,
    List<int> bytes,
    String filename, {
    Duration timeout = shortTimeout,
  }) {
    return postFiles(path, field, [StillFile(bytes: bytes, filename: filename)], timeout: timeout);
  }

  Future<Map<String, dynamic>> postFiles(
    String path,
    String field,
    List<StillFile> files, {
    Duration timeout = shortTimeout,
  }) {
    return _attempt(() => _send(() async {
      final request = http.MultipartRequest('POST', uri(path));
      request.headers['Connection'] = 'close';
      for (final file in files) {
        request.files.add(http.MultipartFile.fromBytes(field, file.bytes, filename: file.filename));
      }
      final streamed = await _client.send(request).timeout(timeout);
      return http.Response.fromStream(streamed);
    }));
  }

  Future<Map<String, dynamic>> _send(Future<http.Response> Function() run) async {
    final http.Response res;
    try {
      res = await run();
    } on TimeoutException {
      throw OmniException('The backend took too long.');
    } on OmniException {
      rethrow;
    } on http.ClientException catch (err) {
      throw OmniException(reachError(err.message));
    } on SocketException catch (err) {
      throw OmniException(reachError(err.message));
    }
    if (res.statusCode >= 400) throw exceptionFrom(res);
    if (res.body.isEmpty) return {};
    final data = jsonDecode(res.body);
    if (data is Map<String, dynamic>) return data;
    if (data is Map) {
      return data.map((key, value) => MapEntry(key.toString(), value));
    }
    throw OmniException('The backend returned an unexpected response.');
  }

  static String projectPath(String id, [String suffix = '']) {
    return '/api/project/${Uri.encodeComponent(id)}$suffix';
  }
}

String reachError(String detail) {
  final text = detail.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (text.isEmpty) return 'Could not reach the desktop board.';
  return 'Could not reach the desktop board. $text';
}

OmniException exceptionFrom(http.Response res) {
  try {
    final data = jsonDecode(res.body);
    if (data is Map && data['detail'] is Map) {
      final detail = data['detail'] as Map;
      final message = detail['message'];
      final raw = detail['needed'];
      final int? needed;
      if (raw is int) {
        needed = raw;
      } else if (raw is num) {
        needed = raw.round();
      } else {
        needed = int.tryParse('$raw');
      }
      if (message is String && message.isNotEmpty) {
        return OmniException(message, statusCode: res.statusCode, needed: needed);
      }
    }
  } catch (_) {}
  return OmniException(readDetail(res), statusCode: res.statusCode);
}

String readDetail(http.Response res) {
  try {
    final data = jsonDecode(res.body);
    if (data is Map) {
      final detail = data['detail'];
      if (detail is String && detail.isNotEmpty) return detail;
      if (detail is List && detail.isNotEmpty) {
        final first = detail.first;
        if (first is Map && first['msg'] is String) return first['msg'] as String;
      }
    }
  } catch (_) {}
  return 'The desktop board refused the request (HTTP ${res.statusCode}).';
}
