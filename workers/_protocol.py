"""Shared JSON-lines loop for model workers.

The engine server writes one JSON request per line to the worker's stdin and reads
one JSON reply per line from its stdout:

    {"op": "load", "device": "auto"}                       -> {"ok": true, "device": "mps"}
    {"op": "synthesize", "segments": [...], "voice": {...},
     "params": {...}, "pause_ms": 280, "out_path": "x.wav"} -> {"ok": true, "duration_s": 3.2, "sample_rate": 24000}

Model libraries print freely, so the real stdout is kept for replies and everything
else (print, warnings, progress bars) is sent to stderr, which the server logs.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from typing import Protocol

import numpy as np
import soundfile as sf


class Engine(Protocol):
    def load(self, device: str) -> str:
        """Load the model; return the device actually used."""

    def synthesize(self, text: str, voice: dict, params: dict) -> tuple[np.ndarray, int]:
        """Return mono float32 audio and its sample rate for one segment."""


def resolve_device(requested: str) -> str:
    import torch

    if requested != "auto":
        return requested
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _synthesize(engine: Engine, request: dict) -> dict:
    pieces: list[np.ndarray] = []
    sample_rate = 0
    for segment in request["segments"]:
        audio, sample_rate = engine.synthesize(segment, request.get("voice", {}), request.get("params", {}))
        audio = np.asarray(audio, dtype=np.float32).reshape(-1)
        if pieces:
            pieces.append(np.zeros(int(sample_rate * request.get("pause_ms", 0) / 1000), dtype=np.float32))
        pieces.append(audio)
    if not pieces:
        raise ValueError("No text to synthesize")
    audio = np.concatenate(pieces)
    peak = float(np.max(np.abs(audio))) or 1.0
    if peak > 0.99:
        audio = audio * (0.99 / peak)
    sf.write(request["out_path"], audio, sample_rate, subtype="PCM_16")
    return {"ok": True, "duration_s": round(len(audio) / sample_rate, 2), "sample_rate": sample_rate}


def serve(engine: Engine) -> None:
    replies = os.fdopen(os.dup(sys.stdout.fileno()), "w", buffering=1)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    sys.stdout = sys.stderr

    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            op = request.get("op")
            if op == "load":
                reply = {"ok": True, "device": engine.load(request.get("device", "auto"))}
            elif op == "synthesize":
                reply = _synthesize(engine, request)
            else:
                reply = {"ok": False, "error": f"unknown op {op!r}"}
        except Exception as exc:
            traceback.print_exc()
            reply = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        replies.write(json.dumps(reply) + "\n")
