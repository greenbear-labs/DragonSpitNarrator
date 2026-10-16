import io
import json
import shutil
import wave

import pytest
from fastapi.testclient import TestClient


def _make_wav(seconds=1.0, rate=16_000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))
    return buf.getvalue()


def test_health_needs_no_token(settings):
    from narrator_engine.api import create_app

    with TestClient(create_app(settings)) as anon:
        assert anon.get("/health").json()["ok"] is True
        assert anon.get("/v1/voices").status_code == 401
        assert anon.get("/v1/voices", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_voice_catalog_has_presets_from_every_engine(client):
    voices = client.get("/v1/voices").json()["voices"]
    ids = {v["id"] for v in voices}
    assert {"kokoro:af_heart", "qwen3:ryan", "chatterbox:default"} <= ids
    assert all("engine_args" not in v for v in voices)
    featured = client.get("/v1/voices", params={"featured": True}).json()["voices"]
    assert 0 < len(featured) < len(voices)


def test_generate_clip_and_download(client, settings):
    clip = client.post(
        "/v1/clips",
        json={"text": "Hello there. This is a test.", "voice_id": "chatterbox:default", "emotion": "excited",
              "intensity": 1.0, "format": "wav", "tags": ["site-a"], "wait": True},
    ).json()
    assert clip["status"] == "done", clip
    assert clip["audio_url"] == f"/v1/clips/{clip['id']}/audio"

    audio = client.get(clip["audio_url"])
    assert audio.status_code == 200
    assert audio.headers["content-type"] == "audio/wav"

    sent = json.loads((settings.clips_dir / f"{clip['id']}.wav.json").read_text())
    assert sent["params"] == {"exaggeration": 0.9, "cfg_weight": 0.3}
    assert sent["segments"] == ["Hello there. This is a test."]

    assert [c["id"] for c in client.get("/v1/clips", params={"tag": "site-a"}).json()["clips"]] == [clip["id"]]
    assert client.get("/v1/clips", params={"tag": "other"}).json()["clips"] == []


def test_audio_link_accepts_token_query(settings, client):
    clip = client.post("/v1/clips", json={"text": "Hi.", "format": "wav", "wait": True}).json()
    from narrator_engine.api import create_app

    with TestClient(create_app(settings)) as anon:
        assert anon.get(f"{clip['audio_url']}?token=test-token").status_code == 200


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
def test_mp3_output(client):
    clip = client.post("/v1/clips", json={"text": "Hi.", "format": "mp3", "wait": True}).json()
    assert clip["status"] == "done", clip
    assert client.get(clip["audio_url"]).headers["content-type"] == "audio/mpeg"
    assert client.get(clip["audio_url"], params={"format": "wav"}).status_code == 200


def test_queued_clip_can_be_polled(client):
    clip = client.post("/v1/clips", json={"text": "Polling.", "format": "wav"}).json()
    assert clip["status"] in {"queued", "running", "done"}
    for _ in range(100):
        clip = client.get(f"/v1/clips/{clip['id']}").json()
        if clip["status"] == "done":
            break
        import time

        time.sleep(0.05)
    assert clip["status"] == "done"


def test_worker_error_marks_clip_failed_and_worker_recovers(client):
    failed = client.post("/v1/clips", json={"text": "EXPLODE", "format": "wav", "wait": True}).json()
    assert failed["status"] == "failed" and "boom" in failed["error"]

    crashed = client.post("/v1/clips", json={"text": "CRASH", "format": "wav", "wait": True}).json()
    assert crashed["status"] == "failed" and "exited" in crashed["error"]

    ok = client.post("/v1/clips", json={"text": "Fine again.", "format": "wav", "wait": True}).json()
    assert ok["status"] == "done"


def test_bad_requests(client):
    assert client.post("/v1/clips", json={"text": "x", "voice_id": "nope"}).status_code == 404
    assert client.post("/v1/clips", json={"text": "x", "emotion": "smug"}).status_code == 400
    assert client.post("/v1/clips", json={"text": ""}).status_code == 422
    assert client.get("/v1/clips/missing").status_code == 404


def test_custom_voice_lifecycle(client, settings):
    files = {"reference": ("me.wav", _make_wav(12), "audio/wav")}
    refused = client.post("/v1/voices", data={"name": "Me", "consent": "false"}, files=files)
    assert refused.status_code == 400

    voice = client.post(
        "/v1/voices", data={"name": "Alex Narrator", "transcript": "Hello", "consent": "true"}, files=files
    ).json()
    assert voice["id"] == "custom:alex-narrator"
    assert voice["engine"] == "chatterbox" and voice["supports_emotion"] is True

    clip = client.post("/v1/clips", json={"text": "Cloned.", "voice_id": voice["id"], "format": "wav", "wait": True}).json()
    sent = json.loads((settings.clips_dir / f"{clip['id']}.wav.json").read_text())
    assert sent["voice"]["audio_prompt_path"].endswith("alex-narrator/reference.wav")

    assert client.delete("/v1/voices/custom:alex-narrator").status_code == 204
    assert client.delete("/v1/voices/custom:..").status_code == 404
    assert client.delete("/v1/voices/kokoro:af_heart").status_code == 400


def test_delete_clip(client, settings):
    clip = client.post("/v1/clips", json={"text": "Bye.", "format": "wav", "wait": True}).json()
    assert client.delete(f"/v1/clips/{clip['id']}").status_code == 204
    assert not (settings.clips_dir / f"{clip['id']}.wav").exists()
    assert client.get(f"/v1/clips/{clip['id']}").status_code == 404


def test_recommended_voices_come_first(client):
    voices = client.get("/v1/voices").json()["voices"]
    assert [v["id"] for v in voices[:2]] == ["kokoro:af_heart", "chatterbox:default"]
    assert all(v["recommended"] for v in voices[:2]) and not voices[2]["recommended"]


def test_vercel_site_can_call_engine_from_browser(client):
    origin = "https://dragonspitnarrator-git-main-greenbear-labs-projects.vercel.app"
    preflight = client.options(
        "/v1/voices",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
            "Access-Control-Request-Private-Network": "true",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == origin
    assert preflight.headers["access-control-allow-private-network"] == "true"

    evil = client.options(
        "/v1/voices",
        headers={"Origin": "https://dragonspitnarrator.evil.com", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in evil.headers
