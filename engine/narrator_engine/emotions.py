"""One emotion vocabulary, translated into each engine's own controls.

Callers pick an emotion and an intensity from 0 to 1. Each engine gets the
closest thing it supports:

- chatterbox: `exaggeration` and `cfg_weight` (higher exaggeration, lower cfg = more dramatic)
- qwen3: a plain-English delivery instruction
- kokoro: no emotion model, so only a small speed change
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Emotion:
    name: str
    description: str
    # Chatterbox targets at intensity 1.0; intensity 0 means neutral (0.5, 0.5).
    exaggeration: float
    cfg_weight: float
    # Qwen3-TTS delivery instruction.
    instruction: str
    # Kokoro speed multiplier at intensity 1.0.
    speed: float


NEUTRAL = Emotion("neutral", "Even, clear narration", 0.5, 0.5, "", 1.0)

EMOTIONS: dict[str, Emotion] = {
    e.name: e
    for e in [
        NEUTRAL,
        Emotion("calm", "Relaxed and steady", 0.35, 0.55, "Speak in a calm, relaxed, steady voice.", 0.94),
        Emotion("warm", "Friendly and inviting", 0.6, 0.45, "Speak in a warm, friendly, inviting tone.", 0.98),
        Emotion("happy", "Cheerful, smiling", 0.7, 0.4, "Speak cheerfully, as if smiling.", 1.04),
        Emotion("excited", "High energy and enthusiastic", 0.9, 0.3, "Speak with high energy and excitement.", 1.1),
        Emotion("sad", "Low and sorrowful", 0.65, 0.4, "Speak in a sad, sorrowful, subdued voice.", 0.9),
        Emotion("angry", "Forceful and tense", 0.95, 0.3, "Speak angrily, with force and tension.", 1.05),
        Emotion("fearful", "Nervous and shaky", 0.8, 0.35, "Speak fearfully, nervous and a little shaky.", 1.03),
        Emotion("whisper", "Soft and secretive", 0.4, 0.5, "Whisper softly, as if sharing a secret.", 0.92),
        Emotion("suspense", "Slow build, hushed tension", 0.75, 0.3, "Narrate with suspense: slow, hushed, building tension.", 0.88),
        Emotion("dramatic", "Theatrical storytelling", 1.0, 0.25, "Narrate dramatically, like an epic movie trailer.", 0.95),
    ]
}


def get_emotion(name: str) -> Emotion:
    try:
        return EMOTIONS[name]
    except KeyError:
        raise ValueError(f"Unknown emotion '{name}'. Choose one of: {', '.join(EMOTIONS)}") from None


def _lerp(a: float, b: float, t: float) -> float:
    return round(a + (b - a) * t, 3)


def engine_params(engine: str, emotion_name: str, intensity: float, speed: float = 1.0) -> dict:
    """Translate (emotion, intensity, speed) into keyword params for one engine's worker."""
    emotion = get_emotion(emotion_name)
    t = min(max(intensity, 0.0), 1.0)

    if engine == "chatterbox":
        return {
            "exaggeration": _lerp(NEUTRAL.exaggeration, emotion.exaggeration, t),
            "cfg_weight": _lerp(NEUTRAL.cfg_weight, emotion.cfg_weight, t),
        }
    if engine == "qwen3":
        instruction = emotion.instruction
        if instruction and t < 0.4:
            instruction = "Slightly. " + instruction
        elif instruction and t > 0.8:
            instruction = instruction + " Make it very pronounced."
        if speed < 0.95:
            instruction = (instruction + " Speak slowly.").strip()
        elif speed > 1.05:
            instruction = (instruction + " Speak quickly.").strip()
        return {"instruct": instruction}
    if engine == "kokoro":
        return {"speed": round(speed * _lerp(1.0, emotion.speed, t), 3)}
    raise ValueError(f"Unknown engine '{engine}'")
