"""Qwen3-TTS worker (Alibaba, Apache 2.0): nine preset speakers steered by plain-English instructions."""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

from _protocol import resolve_device, serve  # noqa: E402

MODEL_ID = os.environ.get("NARRATOR_QWEN3_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice")


class Qwen3Engine:
    def __init__(self):
        self.model = None

    def load(self, device: str) -> str:
        import torch
        from qwen_tts import Qwen3TTSModel

        device = resolve_device(device)
        dtype = torch.float32 if device == "cpu" else torch.bfloat16
        self.model = Qwen3TTSModel.from_pretrained(MODEL_ID, device_map=device, dtype=dtype)
        return device

    def synthesize(self, text: str, voice: dict, params: dict):
        wavs, sample_rate = self.model.generate_custom_voice(
            text=text,
            speaker=voice["speaker"],
            language=voice.get("language", "English"),
            instruct=params.get("instruct") or None,
        )
        return wavs[0], sample_rate


if __name__ == "__main__":
    serve(Qwen3Engine())
