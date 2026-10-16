import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

class OmniException implements Exception {
  OmniException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

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
      : baseUrl = _trim(baseUrl),
        _client = client ?? http.Client(),
        _ownsClient = client == null;

  final String baseUrl;
  final http.Client _client;
  final bool _ownsClient;

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
      throw OmniException('Set the backend address first. Example: http://<tower>:8080');
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
    return _send(() => _client.get(uri(path)).timeout(timeout));
  }

  Future<Map<String, dynamic>> postJson(
    String path,
    Map<String, dynamic> body, {
    Duration timeout = shortTimeout,
  }) {
    return _send(
      () => _client
          .post(
            uri(path),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode(body),
          )
          .timeout(timeout),
    );
  }

  Future<Map<String, dynamic>> delete(String path) {
    return _send(() => _client.delete(uri(path)).timeout(shortTimeout));
  }

  Future<List<int>> getBytes(String path, {Duration timeout = shortTimeout}) async {
    final http.Response res;
    try {
      res = await _client.get(uri(path)).timeout(timeout);
    } on TimeoutException {
      throw OmniException('The backend took too long.');
    } on http.ClientException {
      throw OmniException('Could not reach the backend. Check the address.');
    } on SocketException {
      throw OmniException('Could not reach the backend. Check the address.');
    }
    if (res.statusCode >= 400) {
      throw OmniException(readDetail(res), statusCode: res.statusCode);
    }
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
    return _send(() async {
      final request = http.MultipartRequest('POST', uri(path));
      for (final file in files) {
        request.files.add(http.MultipartFile.fromBytes(field, file.bytes, filename: file.filename));
      }
      final streamed = await _client.send(request).timeout(timeout);
      return http.Response.fromStream(streamed);
    });
  }

  Future<Map<String, dynamic>> _send(Future<http.Response> Function() run) async {
    final http.Response res;
    try {
      res = await run();
    } on TimeoutException {
      throw OmniException('The backend took too long.');
    } on OmniException {
      rethrow;
    } on http.ClientException {
      throw OmniException('Could not reach the backend. Check the address.');
    } on SocketException {
      throw OmniException('Could not reach the backend. Check the address.');
    }
    if (res.statusCode >= 400) {
      throw OmniException(readDetail(res), statusCode: res.statusCode);
    }
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

String readDetail(http.Response res) {
  try {
    final data = jsonDecode(res.body);
    if (data is Map) {
      final detail = data['detail'];
      if (detail is String && detail.isNotEmpty) return detail;
      if (detail is List && detail.isNotEmpty) {
        final first = detail.first;
        if (first is Map && first['msg'] is String) return first['msg'] as String;
        return 'Request failed.';
      }
    }
  } catch (_) {}
  return 'Request failed.';
}

/// Accepts `http://host:8080` or `host:8080`. Returns null when the text is empty or not an HTTP URL.
String? normalizeBase(String raw) {
  var text = raw.trim();
  if (text.isEmpty) return null;
  if (!text.contains('://')) text = 'http://$text';
  final uri = Uri.tryParse(text);
  if (uri == null || uri.host.isEmpty) return null;
  if (uri.scheme != 'http' && uri.scheme != 'https') return null;
  var out = uri.toString();
  if (out.endsWith('/')) out = out.substring(0, out.length - 1);
  return out;
}
