import 'package:shared_preferences/shared_preferences.dart';

abstract class SettingsStore {
  Future<String> loadBaseUrl();
  Future<void> saveBaseUrl(String url);
}

class PrefsSettings implements SettingsStore {
  static const key = 'omnivid_base_url';

  @override
  Future<String> loadBaseUrl() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(key) ?? '';
  }

  @override
  Future<void> saveBaseUrl(String url) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(key, url);
  }
}

class MemorySettings implements SettingsStore {
  MemorySettings([this.value = '']);

  String value;

  @override
  Future<String> loadBaseUrl() async => value;

  @override
  Future<void> saveBaseUrl(String url) async {
    value = url;
  }
}
