# OmniVideo

Local board for turning a song into a music video: lyrics, shots, and stills.

Copyright (c) 2026 Guru Morgan, AllTechGuru. See LICENSE.
Do not use, copy, modify, or run this software without written permission.

## On the author's machine

```bash
pip install -r requirements.txt
python main.py
```

Open http://127.0.0.1:8080

The board listens on port 8080. A phone on another network can use an SSH local forward to http://127.0.0.1:8080.

Songs, stills, and the API key stay on that machine. They are not in this repository.

Original audio is optional. The board still works if that model is down. ACE-Step 1.5 runs on a separate GPU machine, not on the laptop that serves this board. A CPU load of that model runs the laptop out of memory. Point `AUDIO_GEN_URL` at that API. Optional `ACESTEP_API_KEY` is that server's own key, not the xAI key. Only one model should use that GPU at a time. Output is MP3, kept under `generated/`, then copied into the project when the track is used. The song itself is not sent to a cloud service.

## Android client

This branch adds a Flutter phone client in `flutter/`. The screen is six full-width tabs: Generate audio, Transcribe audio, Master, Stills, Clips, and Render Video. Portrait and landscape both use those tabs. The phone does not run models. The desktop still runs `python main.py` and does the generation.

```bash
cd flutter
flutter pub get
flutter run
```

The app calls the desktop board at `http://100.67.76.16:8080`, direct, with no HTTP proxy. That address is compiled in, and the screen has no server field. If that port answers HTTP 408, the app retries `http://100.67.76.16:18080`, which is the same board. Cleartext HTTP is allowed.

Create or open a named project before generating. Those folders are the server's OmniVideo/Projects directory. The existing phone file app can browse them when this branch's server is started with:

```bash
OMNIVIDEO_PROJECTS=/mnt/OBC/OmniVideo/Projects python main.py
```

That variable is the OmniBrain cloud folder, WebDAV path `OmniVideo/Projects/<name>`. Without it, named projects stay in `~/OmniVideo/Projects` on the desktop, which that file app does not browse. The web board is unchanged when the variable is unset. The client lists projects with `GET /api/projects`. Opening a project by name also works with `GET /api/project/<name>`.
