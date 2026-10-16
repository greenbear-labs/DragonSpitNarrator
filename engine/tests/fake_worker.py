"""Stand-in model worker for tests: speaks the worker protocol and writes a short tone per segment."""

import json
import math
import struct
import sys
import wave

RATE = 16_000

for line in sys.stdin:
    request = json.loads(line)
    if request["op"] == "load":
        reply = {"ok": True, "device": "cpu"}
    elif any("EXPLODE" in s for s in request["segments"]):
        reply = {"ok": False, "error": "RuntimeError: boom"}
    elif any("CRASH" in s for s in request["segments"]):
        sys.exit(3)
    else:
        n = int(RATE * 0.1) * len(request["segments"])
        frames = b"".join(struct.pack("<h", int(8000 * math.sin(i / 8))) for i in range(n))
        with wave.open(request["out_path"], "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(frames)
        # Echo what the engine sent so tests can check the emotion mapping and chunking.
        reply = {"ok": True, "duration_s": n / RATE, "sample_rate": RATE, "echo": request}
        with open(request["out_path"] + ".json", "w") as f:
            json.dump(request, f)
    print(json.dumps(reply), flush=True)
