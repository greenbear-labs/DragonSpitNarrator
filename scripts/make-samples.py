#!/usr/bin/env python3
"""Make one sample clip per free voice and save them in web/public/samples for the website.

Run on the Mac mini with the engine running:  python3 scripts/make-samples.py
Then commit web/public/samples and push. The site plays these even while the engine is offline.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "samples"
TEXT = (
    "The dragon woke before dawn, stretched its wings across the valley, "
    "and the whole mountain seemed to hold its breath."
)


def token() -> str:
    if os.environ.get("NARRATOR_TOKEN"):
        return os.environ["NARRATOR_TOKEN"]
    data_dir = Path(os.environ.get("NARRATOR_DATA_DIR", "~/.dragonspit-narrator")).expanduser()
    return (data_dir / "api-token").read_text().strip()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", default="http://127.0.0.1:8765")
    parser.add_argument("--text", default=TEXT)
    args = parser.parse_args()
    auth = {"Authorization": f"Bearer {token()}"}

    def get(path: str) -> bytes:
        with urllib.request.urlopen(urllib.request.Request(args.engine + path, headers=auth), timeout=900) as r:
            return r.read()

    def post(path: str, body: dict) -> dict:
        request = urllib.request.Request(
            args.engine + path, data=json.dumps(body).encode(), method="POST",
            headers={**auth, "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=900) as r:
            return json.loads(r.read())

    voices = [v for v in json.loads(get("/v1/voices?featured=true"))["voices"] if v["source"] == "preset"]
    OUT.mkdir(parents=True, exist_ok=True)
    entries = []
    for voice in voices:
        emotion = "suspense" if voice["supports_emotion"] else "neutral"
        print(f"{voice['name']} ({voice['id']})...", flush=True)
        clip = post("/v1/clips", {"text": args.text, "voice_id": voice["id"], "emotion": emotion,
                                  "intensity": 0.6, "format": "mp3", "tags": ["website-sample"], "wait": True})
        if clip["status"] != "done":
            print(f"  skipped: {clip.get('error') or clip['status']}")
            continue
        file = re.sub(r"[^a-z0-9]+", "-", voice["id"].lower()).strip("-") + ".mp3"
        (OUT / file).write_bytes(get(clip["audio_url"]))
        entries.append({**voice, "voice_id": voice["id"], "file": f"/samples/{file}", "text": args.text, "emotion": emotion})

    manifest = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "voices": entries}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Saved {len(entries)} samples to {OUT}. Commit and push them to update the site.")


if __name__ == "__main__":
    main()
