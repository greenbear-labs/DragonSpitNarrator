"""Runtime settings, read from environment variables."""

from __future__ import annotations

import os
import secrets
import shlex
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKERS_DIR = REPO_ROOT / "workers"

DEFAULT_ORIGINS = [
    "https://narrator.greenbearlabs.com",
    "http://localhost:5173",
]
ALL_ENGINES = ["kokoro", "chatterbox", "qwen3"]


def _default_worker_command(engine: str) -> list[str]:
    project = WORKERS_DIR / engine
    return ["uv", "run", "--project", str(project), "python", str(project / "worker.py")]


@dataclass
class Settings:
    data_dir: Path
    token: str
    host: str = "127.0.0.1"
    port: int = 8765
    cors_origins: list[str] = field(default_factory=lambda: list(DEFAULT_ORIGINS))
    engines: list[str] = field(default_factory=lambda: list(ALL_ENGINES))
    worker_commands: dict[str, list[str]] = field(default_factory=dict)
    device: str = "auto"

    @property
    def clips_dir(self) -> Path:
        return self.data_dir / "clips"

    @property
    def voices_dir(self) -> Path:
        return self.data_dir / "voices"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "narrator.db"

    def worker_command(self, engine: str) -> list[str]:
        return self.worker_commands.get(engine) or _default_worker_command(engine)

    def ensure_dirs(self) -> None:
        for path in (self.data_dir, self.clips_dir, self.voices_dir):
            path.mkdir(parents=True, exist_ok=True)


def _load_or_create_token(data_dir: Path) -> str:
    token_file = data_dir / "api-token"
    if token_file.exists():
        return token_file.read_text().strip()
    data_dir.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    token_file.write_text(token + "\n")
    token_file.chmod(0o600)
    return token


def load_settings() -> Settings:
    env = os.environ
    data_dir = Path(env.get("NARRATOR_DATA_DIR", "~/.dragonspit-narrator")).expanduser()
    token = env.get("NARRATOR_TOKEN") or _load_or_create_token(data_dir)

    engines = [e.strip() for e in env.get("NARRATOR_ENGINES", ",".join(ALL_ENGINES)).split(",") if e.strip()]
    unknown = set(engines) - set(ALL_ENGINES)
    if unknown:
        raise ValueError(f"Unknown engines in NARRATOR_ENGINES: {sorted(unknown)}")

    # NARRATOR_WORKER_<ENGINE>="cmd args" overrides how a worker is launched (used by tests).
    worker_commands = {
        e: shlex.split(env[f"NARRATOR_WORKER_{e.upper()}"])
        for e in ALL_ENGINES
        if env.get(f"NARRATOR_WORKER_{e.upper()}")
    }

    origins = env.get("NARRATOR_CORS_ORIGINS")
    settings = Settings(
        data_dir=data_dir,
        token=token,
        host=env.get("NARRATOR_HOST", "127.0.0.1"),
        port=int(env.get("NARRATOR_PORT", "8765")),
        cors_origins=[o.strip() for o in origins.split(",")] if origins else list(DEFAULT_ORIGINS),
        engines=engines,
        worker_commands=worker_commands,
        device=env.get("NARRATOR_DEVICE", "auto"),
    )
    settings.ensure_dirs()
    return settings
