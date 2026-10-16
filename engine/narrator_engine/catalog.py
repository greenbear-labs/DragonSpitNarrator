"""Voice catalog: preset voices that ship with each model, plus saved custom voices."""

from __future__ import annotations

import json
import re
import shutil
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class Voice:
    id: str
    name: str
    engine: str
    description: str
    gender: str = ""
    accent: str = ""
    # Kokoro's own quality grade from its VOICES.md (A is best); empty for other engines.
    grade: str = ""
    supports_emotion: bool = False
    source: str = "preset"  # "preset" or "custom"
    featured: bool = False
    # Alex's chosen defaults, shown first in the web UI.
    recommended: bool = False
    # Engine-specific parameters passed to the worker (Kokoro voice name, Qwen speaker, reference clip).
    engine_args: dict = field(default_factory=dict)
    created_at: str | None = None

    def public(self) -> dict:
        data = asdict(self)
        data.pop("engine_args")
        return data


RECOMMENDED_KOKORO = {"af_heart"}


def _kokoro(voice: str, name: str, gender: str, accent: str, grade: str, description: str) -> Voice:
    return Voice(
        id=f"kokoro:{voice}",
        name=name,
        engine="kokoro",
        description=description,
        gender=gender,
        accent=accent,
        grade=grade,
        featured=grade in {"A", "A-", "B-"},
        recommended=voice in RECOMMENDED_KOKORO,
        engine_args={"voice": voice, "lang_code": "a" if accent == "American" else "b"},
    )


def _qwen(speaker: str, gender: str, description: str, featured: bool = False) -> Voice:
    return Voice(
        id=f"qwen3:{speaker.lower()}",
        name=speaker.replace("_", " "),
        engine="qwen3",
        description=description,
        gender=gender,
        supports_emotion=True,
        featured=featured,
        engine_args={"speaker": speaker},
    )


# Grades are Kokoro's own, from hexgrad/Kokoro-82M VOICES.md. Voices graded D or below are left out.
KOKORO_PRESETS = [
    _kokoro("af_heart", "Heart", "female", "American", "A", "Kokoro's top-graded voice"),
    _kokoro("af_bella", "Bella", "female", "American", "A-", "American female"),
    _kokoro("af_nicole", "Nicole", "female", "American", "B-", "American female, soft delivery"),
    _kokoro("af_aoede", "Aoede", "female", "American", "C+", "American female"),
    _kokoro("af_kore", "Kore", "female", "American", "C+", "American female"),
    _kokoro("af_sarah", "Sarah", "female", "American", "C+", "American female"),
    _kokoro("af_alloy", "Alloy", "female", "American", "C", "American female"),
    _kokoro("af_nova", "Nova", "female", "American", "C", "American female"),
    _kokoro("af_sky", "Sky", "female", "American", "C-", "American female"),
    _kokoro("am_michael", "Michael", "male", "American", "C+", "American male"),
    _kokoro("am_fenrir", "Fenrir", "male", "American", "C+", "American male"),
    _kokoro("am_puck", "Puck", "male", "American", "C+", "American male"),
    _kokoro("bf_emma", "Emma", "female", "British", "B-", "British female"),
    _kokoro("bf_isabella", "Isabella", "female", "British", "C", "British female"),
    _kokoro("bm_george", "George", "male", "British", "C", "British male"),
    _kokoro("bm_fable", "Fable", "male", "British", "C", "British male"),
]

# Preset speakers of Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice. All speak English; Ryan and Aiden are native.
QWEN_PRESETS = [
    _qwen("Ryan", "male", "Dynamic male voice with strong rhythmic drive (native English)", featured=True),
    _qwen("Aiden", "male", "Sunny American male with a clear midrange (native English)", featured=True),
    _qwen("Serena", "female", "Warm, gentle young female"),
    _qwen("Vivian", "female", "Bright, slightly edgy young female"),
    _qwen("Sohee", "female", "Warm female with rich emotion"),
    _qwen("Ono_Anna", "female", "Playful female with a light, nimble timbre"),
    _qwen("Uncle_Fu", "male", "Seasoned male with a low, mellow timbre"),
    _qwen("Dylan", "male", "Youthful, clear and natural male"),
    _qwen("Eric", "male", "Lively male with a slightly husky brightness"),
]

CHATTERBOX_PRESETS = [
    Voice(
        id="chatterbox:default",
        name="Chatterbox",
        engine="chatterbox",
        description="Chatterbox's built-in male voice, with full emotion control",
        gender="male",
        supports_emotion=True,
        featured=True,
        recommended=True,
        engine_args={},
    )
]

PRESETS = KOKORO_PRESETS + QWEN_PRESETS + CHATTERBOX_PRESETS


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:48] or "voice"


class VoiceCatalog:
    """Presets are in code; custom voices live in <data>/voices/<slug>/voice.json + reference audio."""

    def __init__(self, voices_dir: Path, engines: list[str]):
        self.voices_dir = voices_dir
        self.engines = engines

    def _custom_voices(self) -> list[Voice]:
        voices = []
        for meta in sorted(self.voices_dir.glob("*/voice.json")):
            data = json.loads(meta.read_text())
            data["engine_args"]["audio_prompt_path"] = str(meta.parent / data["engine_args"]["reference_file"])
            voices.append(Voice(**data))
        return voices

    def list(self) -> list[Voice]:
        voices = [v for v in PRESETS + self._custom_voices() if v.engine in self.engines]
        # Recommended first, then custom, then everything else; stable within each group.
        return sorted(voices, key=lambda v: (not v.recommended, v.source != "custom"))

    def get(self, voice_id: str) -> Voice:
        for voice in self.list():
            if voice.id == voice_id:
                return voice
        raise KeyError(voice_id)

    def add_custom(
        self,
        name: str,
        reference_audio: Path,
        transcript: str,
        description: str = "",
        engine: str = "chatterbox",
    ) -> Voice:
        slug = slugify(name)
        target = self.voices_dir / slug
        n = 2
        while target.exists():
            target = self.voices_dir / f"{slug}-{n}"
            n += 1
        target.mkdir(parents=True)
        reference_file = "reference" + (reference_audio.suffix or ".wav")
        shutil.copyfile(reference_audio, target / reference_file)

        voice = Voice(
            id=f"custom:{target.name}",
            name=name,
            engine=engine,
            description=description or "Custom cloned voice",
            supports_emotion=engine == "chatterbox",
            source="custom",
            featured=True,
            engine_args={"reference_file": reference_file, "transcript": transcript},
            created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
        (target / "voice.json").write_text(json.dumps(asdict(voice), indent=2))
        return self.get(voice.id)

    def delete_custom(self, voice_id: str) -> None:
        if not voice_id.startswith("custom:"):
            raise ValueError("Only custom voices can be deleted")
        slug = voice_id.removeprefix("custom:")
        target = self.voices_dir / slug
        if not re.fullmatch(r"[a-z0-9-]+", slug) or not (target / "voice.json").exists():
            raise KeyError(voice_id)
        shutil.rmtree(target)
