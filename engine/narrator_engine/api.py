"""HTTP API. The web UI, the Claude connector and scripts all use these endpoints."""

from __future__ import annotations

import secrets
import tempfile
from concurrent.futures import TimeoutError as FutureTimeout
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import __version__
from .catalog import VoiceCatalog
from .clips import ClipStore
from .config import Settings
from .emotions import EMOTIONS
from .workers import WorkerPool

MAX_TEXT_CHARS = 20_000
MAX_REFERENCE_BYTES = 25 * 1024 * 1024
WAIT_TIMEOUT_S = 600


class ClipRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    voice_id: str = "kokoro:af_heart"
    emotion: str = "neutral"
    intensity: float = Field(0.6, ge=0.0, le=1.0)
    speed: float = Field(1.0, ge=0.5, le=2.0)
    format: Literal["wav", "mp3"] = "mp3"
    tags: list[str] = Field(default_factory=list, max_length=20)
    wait: bool = Field(False, description="Block until the clip is finished instead of returning a queued job")


def create_app(settings: Settings) -> FastAPI:
    pool = WorkerPool(
        {engine: settings.worker_command(engine) for engine in settings.engines},
        log_dir=settings.data_dir / "logs",
        device=settings.device,
    )
    catalog = VoiceCatalog(settings.voices_dir, settings.engines)
    store = ClipStore(settings.db_path, settings.clips_dir, pool)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        store.shutdown()
        pool.stop_all()

    app = FastAPI(title="Dragon Spit Narrator engine", version=__version__, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex,
        allow_methods=["*"],
        allow_headers=["*"],
        # Chrome asks a localhost server to opt in before a public website may call it.
        allow_private_network=True,
    )

    app.state.settings, app.state.pool, app.state.catalog, app.state.store = settings, pool, catalog, store

    def require_token(request: Request) -> None:
        header = request.headers.get("authorization", "")
        supplied = header.removeprefix("Bearer ").strip() if header.startswith("Bearer ") else ""
        # Browsers can't set headers on <audio src>, so audio links may carry ?token= instead.
        supplied = supplied or request.query_params.get("token", "")
        if not supplied or not secrets.compare_digest(supplied, settings.token):
            raise HTTPException(401, "Missing or invalid API token")

    auth = [Depends(require_token)]

    @app.get("/health")
    def health():
        return {"ok": True, "version": __version__, "engines": pool.status()}

    @app.get("/v1/voices", dependencies=auth)
    def list_voices(engine: str | None = None, featured: bool = False):
        voices = [v for v in catalog.list() if (not engine or v.engine == engine) and (not featured or v.featured)]
        return {"voices": [v.public() for v in voices]}

    @app.get("/v1/emotions", dependencies=auth)
    def list_emotions():
        return {"emotions": [{"name": e.name, "description": e.description} for e in EMOTIONS.values()]}

    @app.post("/v1/voices", dependencies=auth, status_code=201)
    async def add_voice(
        name: str = Form(..., min_length=1, max_length=80),
        transcript: str = Form("", max_length=2000),
        description: str = Form("", max_length=300),
        consent: bool = Form(...),
        reference: UploadFile = File(..., description="10 to 30 seconds of clean speech"),
    ):
        if not consent:
            raise HTTPException(400, "Confirm you have the speaker's permission to clone this voice")
        if "chatterbox" not in settings.engines:
            raise HTTPException(400, "Voice cloning needs the chatterbox engine enabled")
        data = await reference.read()
        if len(data) > MAX_REFERENCE_BYTES:
            raise HTTPException(413, "Reference audio must be under 25 MB")
        suffix = Path(reference.filename or "reference.wav").suffix.lower()
        if suffix not in {".wav", ".mp3", ".m4a", ".flac", ".ogg"}:
            raise HTTPException(400, "Reference audio must be wav, mp3, m4a, flac or ogg")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / f"reference{suffix}"
            path.write_bytes(data)
            voice = catalog.add_custom(name, path, transcript, description)
        return voice.public()

    @app.delete("/v1/voices/{voice_id}", dependencies=auth, status_code=204)
    def delete_voice(voice_id: str):
        try:
            catalog.delete_custom(voice_id)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        except KeyError:
            raise HTTPException(404, "Voice not found")

    @app.post("/v1/clips", dependencies=auth, status_code=202)
    def create_clip(req: ClipRequest):
        try:
            voice = catalog.get(req.voice_id)
        except KeyError:
            raise HTTPException(404, f"Unknown voice '{req.voice_id}'. List voices with GET /v1/voices")
        if req.emotion not in EMOTIONS:
            raise HTTPException(400, f"Unknown emotion '{req.emotion}'. Choose one of: {', '.join(EMOTIONS)}")
        clip_id, future = store.submit(
            text=req.text,
            voice=voice,
            emotion=req.emotion,
            intensity=req.intensity,
            speed=req.speed,
            fmt=req.format,
            tags=req.tags,
        )
        if req.wait:
            try:
                future.result(timeout=WAIT_TIMEOUT_S)
            except FutureTimeout:
                pass  # still running; the caller polls GET /v1/clips/{id}
        return store.get(clip_id)

    @app.get("/v1/clips", dependencies=auth)
    def list_clips(tag: str | None = None, limit: int = 50):
        return {"clips": store.list(tag=tag, limit=min(max(limit, 1), 500))}

    @app.get("/v1/clips/{clip_id}", dependencies=auth)
    def get_clip(clip_id: str):
        clip = store.get(clip_id)
        if not clip:
            raise HTTPException(404, "Clip not found")
        return clip

    @app.get("/v1/clips/{clip_id}/audio", dependencies=auth)
    def get_audio(clip_id: str, format: Literal["wav", "mp3"] | None = None):
        clip = store.get(clip_id)
        if not clip or clip["status"] != "done":
            raise HTTPException(404, "Clip audio not available")
        fmt = format or clip["format"]
        path = store.audio_path(clip_id, fmt)
        if not path.exists():
            raise HTTPException(404, f"No {fmt} file for this clip")
        media = "audio/mpeg" if fmt == "mp3" else "audio/wav"
        return FileResponse(path, media_type=media, filename=f"narration-{clip_id}.{fmt}")

    @app.delete("/v1/clips/{clip_id}", dependencies=auth, status_code=204)
    def delete_clip(clip_id: str):
        if not store.delete(clip_id):
            raise HTTPException(404, "Clip not found")

    return app
