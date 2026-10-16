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
