"""Kokoro-82M worker: 54 preset voices, fast enough to run on CPU."""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import numpy as np  # noqa: E402

from _protocol import resolve_device, serve  # noqa: E402

SAMPLE_RATE = 24_000


class KokoroEngine:
    def __init__(self):
        self.device = "cpu"
        self.model = None
        self.pipelines = {}

    def load(self, device: str) -> str:
        from kokoro import KModel

        # Kokoro is small; CPU is fast and avoids MPS op gaps. Set NARRATOR_DEVICE=mps to try the GPU.
        self.device = "cpu" if device == "auto" else resolve_device(device)
        self.model = KModel().to(self.device).eval()
        return self.device

    def _pipeline(self, lang_code: str):
        from kokoro import KPipeline

        if lang_code not in self.pipelines:
            self.pipelines[lang_code] = KPipeline(lang_code=lang_code, model=self.model)
        return self.pipelines[lang_code]

    def synthesize(self, text: str, voice: dict, params: dict):
        pipeline = self._pipeline(voice.get("lang_code", "a"))
        chunks = [
            result.audio.detach().cpu().numpy()
            for result in pipeline(text, voice=voice["voice"], speed=params.get("speed", 1.0))
            if result.audio is not None
        ]
        return (np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)), SAMPLE_RATE


if __name__ == "__main__":
    serve(KokoroEngine())
