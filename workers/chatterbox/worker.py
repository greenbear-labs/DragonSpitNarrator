"""Chatterbox worker (Resemble AI, MIT): voice cloning from a reference clip plus emotion intensity.

Uses the original Chatterbox model rather than Turbo, because Turbo ignores the
`exaggeration` and `cfg_weight` controls that carry emotion.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

from _protocol import resolve_device, serve  # noqa: E402


class ChatterboxEngine:
    def __init__(self):
        self.model = None
        self.prepared_for: str | None = None

    def load(self, device: str) -> str:
        from chatterbox.tts import ChatterboxTTS

        device = resolve_device(device)
        self.model = ChatterboxTTS.from_pretrained(device=device)
        self.default_conds = self.model.conds
        return device

    def synthesize(self, text: str, voice: dict, params: dict):
        exaggeration = float(params.get("exaggeration", 0.5))
        prompt = voice.get("audio_prompt_path")

        # Embedding the reference clip is the slow part; reuse it across segments of the same voice.
        # generate() updates the exaggeration on the prepared conditionals by itself.
        if prompt and self.prepared_for != prompt:
            self.model.prepare_conditionals(prompt, exaggeration=exaggeration)
            self.prepared_for = prompt
        elif not prompt and self.prepared_for is not None:
            self.model.conds = self.default_conds
            self.prepared_for = None

        wav = self.model.generate(
            text,
            exaggeration=exaggeration,
            cfg_weight=float(params.get("cfg_weight", 0.5)),
            temperature=float(params.get("temperature", 0.8)),
        )
        return wav.squeeze(0).numpy(), self.model.sr


if __name__ == "__main__":
    serve(ChatterboxEngine())
