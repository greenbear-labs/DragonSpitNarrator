# Dragon Spit Narrator

Natural-sounding narration clips from local, open-source voice models, served from a Mac mini to a public web page and to Claude through an API.

The repository has three parts:

- `engine/` and `workers/`: the voice engine, an HTTP API that runs on the Mac mini and routes each request to the right model.
- `web/`: the web page (Vite + React), deployed by Vercel from `main`.
- `api/`: the relay, a Vercel function the web page talks to. It is the only thing that talks to the engine.

## The public website

Anyone can use the site without signing in, within a small daily allowance. A personal key removes the limit.

| | Free visitor | With a key |
| --- | --- | --- |
| Characters a day | 1,000 (`FREE_DAILY_CHARS`), counted by IP address and a browser cookie | Unlimited |
| Voices | The seven featured preset voices | Every voice, including cloned ones |
| Emotion, intensity, speed | Yes | Yes |
| Voice cloning, WAV, tags, deleting | No | Yes |
| Clips they can see | Only their own | All clips |

All free visitors together are capped at 20,000 characters a day (`FREE_GLOBAL_DAILY_CHARS`), and each visitor waits for one clip to finish before starting the next, so a burst of visitors can't tie up the Mac. When the Mac is off or asleep, the site switches to "resting" mode: Generate is disabled and the voice cards play the samples saved in `web/public/samples`.

Browsers never see the engine or its token. The relay (`api/_lib/relay.ts`) holds the token, checks the allowance or key, and forwards the request to the engine through the tunnel.

### Setting it up

1. **Make the engine reachable from the internet** with a tunnel; the engine itself keeps listening only on `127.0.0.1`. With [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) on a domain in your Cloudflare account:

   ```bash
   brew install cloudflared
   cloudflared tunnel login
   cloudflared tunnel create narrator
   cloudflared tunnel route dns narrator engine.greenbearlabs.com
   cloudflared tunnel run --url http://127.0.0.1:8765 narrator
   ```

   To keep it running after a restart, install it as a service (`cloudflared service install`, see Cloudflare's guide). Without a domain on Cloudflare, `tailscale funnel 8765` gives a fixed `https://<mac>.<tailnet>.ts.net` address instead.

2. **Add a Redis store** so the daily allowance survives between requests: in the Vercel project, Storage → Marketplace → Upstash Redis (the free plan is plenty). It sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you. Without it, counts only last as long as one function instance.

3. **Set the environment variables** in Vercel (Settings → Environment Variables), then redeploy:

   | Variable | Value |
   | --- | --- |
   | `ENGINE_URL` | The tunnel address, e.g. `https://engine.greenbearlabs.com` |
   | `ENGINE_TOKEN` | The output of `uv run narrator-engine token` on the Mac mini. It also works as the owner's key on the site. |
   | `NARRATOR_KEYS` | Personal keys as `name:key`, separated by commas, e.g. `sam:Xk2…,jo:9fQ…`. Remove one and redeploy to switch it off. Keys shorter than 16 characters are ignored. |
   | `FREE_DAILY_CHARS` | Optional, default `1000` |
   | `FREE_GLOBAL_DAILY_CHARS` | Optional, default `20000` |

   Make a key with `python3 -c "import secrets; print(secrets.token_urlsafe(24))"`.

4. **Save voice samples** for resting mode: with the engine running, `python3 scripts/make-samples.py` on the Mac mini, then commit and push `web/public/samples`.

Scripts and Claude can use the relay too: send `Authorization: Bearer <key>` to `https://<site>/api/...`. The routes mirror the engine's (`/api/voices`, `/api/clips`, `/api/clips/{id}/audio`, ...), plus `/api/status`.

### On the Mac mini without the tunnel

Open **Have a key? → Connect straight to the engine**, and paste the engine token. The page then skips the relay and talks to `http://127.0.0.1:8765` from the browser (Chrome asks once to allow local network access). Leave the token empty to go back to the normal site.

### Local development

```bash
cd web
npm install
npm run dev      # http://localhost:5173; /api runs the same relay, pointed at the engine on 127.0.0.1:8765
npm test         # relay tests against a stand-in engine
```

Put `ENGINE_TOKEN=...` (and optionally `NARRATOR_KEYS`) in `web/.env.local` so the dev relay can reach your local engine.

## Engines and voices

| Engine | License | Voices | Emotion control |
| --- | --- | --- | --- |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) | Apache 2.0 | 16 English presets (grade C- or better from Kokoro's own ratings) | Speed only |
| [Chatterbox](https://github.com/resemble-ai/chatterbox) | MIT | Built-in voice plus any cloned voice | `exaggeration` and `cfg_weight`, driven by the emotion picker |
| [Qwen3-TTS CustomVoice 1.7B](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice) | Apache 2.0 | 9 preset speakers (Ryan and Aiden are native English) | Plain-English delivery instructions |

Every request picks one emotion (`neutral`, `calm`, `warm`, `happy`, `excited`, `sad`, `angry`, `fearful`, `whisper`, `suspense`, `dramatic`) and an intensity from 0 to 1, and the engine translates that into each model's own controls (`engine/narrator_engine/emotions.py`).

Each model runs in its own process and Python environment under `workers/`, because Chatterbox and Qwen3-TTS pin incompatible versions of `transformers`. A worker starts on its first request and stays loaded.

## Setup on the Mac mini

```bash
git clone https://github.com/greenbear-labs/DragonSpitNarrator.git
cd DragonSpitNarrator
scripts/setup-mac.sh                 # installs uv, ffmpeg, espeak-ng and each engine's environment
cd engine && uv run narrator-engine serve
```

The engine listens on `http://127.0.0.1:8765`. Models download from Hugging Face on first use, so the first clip from each engine takes a few minutes. Memory: Kokoro needs well under 1 GB, Chatterbox about 3 GB, Qwen3-TTS about 5 GB; set `NARRATOR_ENGINES=kokoro,chatterbox` to skip one.

To keep it running in the background and start at login: `scripts/install-service.sh` (remove with `--remove`).

## Using the API

All `/v1` endpoints need the token printed by `uv run narrator-engine token`.

```bash
TOKEN=$(cd engine && uv run narrator-engine token)

# List voices (add ?featured=true for the best ones)
curl -s -H "Authorization: Bearer $TOKEN" localhost:8765/v1/voices

# Make a clip and wait for it
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" localhost:8765/v1/clips \
  -d '{"text": "The dragon woke, and the mountain held its breath.", "voice_id": "chatterbox:default",
       "emotion": "suspense", "intensity": 0.8, "format": "mp3", "tags": ["demo"], "wait": true}'

# Download it
curl -s -H "Authorization: Bearer $TOKEN" -o clip.mp3 localhost:8765/v1/clips/<id>/audio

# Clone a voice (10 to 30 seconds of clean speech, with the speaker's permission)
curl -s -H "Authorization: Bearer $TOKEN" localhost:8765/v1/voices \
  -F name="Alex" -F transcript="What I said in the clip" -F consent=true -F reference=@me.wav
```

Without `"wait": true`, `POST /v1/clips` returns at once with `status: "queued"`; poll `GET /v1/clips/{id}` until it is `done` or `failed`. Interactive docs are at `http://127.0.0.1:8765/docs`.

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Engine status (no token) |
| `GET /v1/voices` | Preset and custom voices; filter with `engine` and `featured` |
| `POST /v1/voices` | Save a cloned voice (multipart, `consent=true` required) |
| `DELETE /v1/voices/{id}` | Delete a custom voice |
| `GET /v1/emotions` | The emotion vocabulary |
| `POST /v1/clips` | Generate a clip |
| `GET /v1/clips` | Recent clips; filter with `tag` |
| `GET /v1/clips/{id}` | One clip's status and metadata |
| `GET /v1/clips/{id}/audio` | The audio file (`?format=wav` for the master) |
| `DELETE /v1/clips/{id}` | Delete a clip |

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `NARRATOR_DATA_DIR` | `~/.dragonspit-narrator` | Clips, custom voices, database, logs, API token |
| `NARRATOR_ENGINES` | `kokoro,chatterbox,qwen3` | Engines to enable |
| `NARRATOR_HOST` / `NARRATOR_PORT` | `127.0.0.1` / `8765` | Bind address |
| `NARRATOR_TOKEN` | generated | Override the API token |
| `NARRATOR_CORS_ORIGINS` | `https://narrator.greenbearlabs.com,http://localhost:5173` | Browser origins allowed to call the API |
| `NARRATOR_CORS_ORIGIN_REGEX` | `https://dragonspitnarrator[a-z0-9-]*\.vercel\.app` | Also allowed: the Vercel deployments of the web page |
| `NARRATOR_DEVICE` | `auto` | `mps`, `cpu` or `cuda`; Kokoro uses CPU unless set |

Worker logs are in `~/.dragonspit-narrator/logs/<engine>.log`.

## Development

```bash
cd engine
uv run pytest
```

Tests use a stand-in worker (`engine/tests/fake_worker.py`), so they run without downloading any model.

## Voice cloning

Only clone your own voice or a voice whose owner has agreed. The API refuses an upload without `consent=true`. Chatterbox adds an inaudible watermark to everything it generates.
