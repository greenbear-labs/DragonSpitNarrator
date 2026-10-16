"""Clip jobs: queued per engine, run on that engine's worker, recorded in SQLite."""

from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from .catalog import Voice
from .emotions import engine_params
from .text import split_segments
from .workers import WorkerPool

SCHEMA = """
CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    text TEXT NOT NULL,
    voice_id TEXT NOT NULL,
    engine TEXT NOT NULL,
    emotion TEXT NOT NULL,
    intensity REAL NOT NULL,
    speed REAL NOT NULL,
    format TEXT NOT NULL,
    tags TEXT NOT NULL,
    duration_s REAL,
    error TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
)
"""

PAUSE_MS = 280


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class ClipStore:
    def __init__(self, db_path: Path, clips_dir: Path, pool: WorkerPool):
        self.clips_dir = clips_dir
        self.pool = pool
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db_lock = threading.Lock()
        with self._db_lock:
            self._db.execute(SCHEMA)
            # Jobs that were in flight when the engine last stopped will never finish.
            self._db.execute(
                "UPDATE clips SET status='failed', error='engine restarted' WHERE status IN ('queued','running')"
            )
            self._db.commit()
        self._executors: dict[str, ThreadPoolExecutor] = {}

    # --- records -------------------------------------------------------------

    def _update(self, clip_id: str, **fields) -> None:
        cols = ", ".join(f"{k}=?" for k in fields)
        with self._db_lock:
            self._db.execute(f"UPDATE clips SET {cols} WHERE id=?", [*fields.values(), clip_id])
            self._db.commit()

    def _row(self, row: sqlite3.Row) -> dict:
        data = dict(row)
        data["tags"] = json.loads(data["tags"])
        data["audio_url"] = f"/v1/clips/{data['id']}/audio" if data["status"] == "done" else None
        return data

    def get(self, clip_id: str) -> dict | None:
        with self._db_lock:
            row = self._db.execute("SELECT * FROM clips WHERE id=?", [clip_id]).fetchone()
        return self._row(row) if row else None

    def list(self, tag: str | None = None, limit: int = 50) -> list[dict]:
        query, args = "SELECT * FROM clips", []
        if tag:
            query += " WHERE EXISTS (SELECT 1 FROM json_each(clips.tags) WHERE value = ?)"
            args.append(tag)
        query += " ORDER BY created_at DESC, rowid DESC LIMIT ?"
        with self._db_lock:
            rows = self._db.execute(query, [*args, limit]).fetchall()
        return [self._row(r) for r in rows]

    def audio_path(self, clip_id: str, fmt: str) -> Path:
        return self.clips_dir / f"{clip_id}.{fmt}"

    def delete(self, clip_id: str) -> bool:
        with self._db_lock:
            deleted = self._db.execute("DELETE FROM clips WHERE id=?", [clip_id]).rowcount
            self._db.commit()
        for fmt in ("wav", "mp3"):
            self.audio_path(clip_id, fmt).unlink(missing_ok=True)
        return bool(deleted)

    # --- jobs ----------------------------------------------------------------

    def submit(self, *, text: str, voice: Voice, emotion: str, intensity: float, speed: float, fmt: str, tags: list[str]):
        clip_id = uuid.uuid4().hex[:12]
        with self._db_lock:
            self._db.execute(
                "INSERT INTO clips (id, status, text, voice_id, engine, emotion, intensity, speed, format, tags, created_at)"
                " VALUES (?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [clip_id, text, voice.id, voice.engine, emotion, intensity, speed, fmt, json.dumps(tags), _now()],
            )
            self._db.commit()
        executor = self._executors.setdefault(voice.engine, ThreadPoolExecutor(max_workers=1))
        future = executor.submit(self._run, clip_id, text, voice, emotion, intensity, speed, fmt)
        return clip_id, future

    def _run(self, clip_id, text, voice: Voice, emotion, intensity, speed, fmt) -> None:
        self._update(clip_id, status="running")
        wav_path = self.audio_path(clip_id, "wav")
        try:
            reply = self.pool.get(voice.engine).request(
                {
                    "op": "synthesize",
                    "segments": split_segments(text),
                    "voice": voice.engine_args,
                    "params": engine_params(voice.engine, emotion, intensity, speed),
                    "pause_ms": PAUSE_MS,
                    "out_path": str(wav_path),
                }
            )
            if fmt == "mp3":
                _to_mp3(wav_path, self.audio_path(clip_id, "mp3"))
            self._update(clip_id, status="done", duration_s=reply.get("duration_s"), finished_at=_now())
        except Exception as exc:
            self._update(clip_id, status="failed", error=str(exc), finished_at=_now())

    def shutdown(self) -> None:
        for executor in self._executors.values():
            executor.shutdown(wait=False, cancel_futures=True)


def _to_mp3(wav_path: Path, mp3_path: Path) -> None:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("MP3 output needs ffmpeg (brew install ffmpeg); WAV is available")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path), "-codec:a", "libmp3lame", "-b:a", "192k", str(mp3_path)],
        check=True,
    )
