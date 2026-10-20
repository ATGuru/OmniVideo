# OmniVideo Android client

Landscape thin client for the desktop board. The models stay on the desktop.

The app calls the desktop board at `http://100.67.76.16:8080`, and retries port 18080 if that answer is HTTP 408. There is no server field. The screen is six full-width tabs, in portrait or landscape. See the Android client section in the repository README for where project files are stored.

```bash
flutter pub get
flutter run
```

The phone does not run ACE-Step or image generation.
