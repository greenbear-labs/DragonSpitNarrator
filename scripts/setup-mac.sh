#!/usr/bin/env bash
# One-time setup on the Mac mini: installs tools, then each engine's Python environment.
# Usage: scripts/setup-mac.sh            (all engines)
#        NARRATOR_ENGINES=kokoro,chatterbox scripts/setup-mac.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINES="${NARRATOR_ENGINES:-kokoro,chatterbox,qwen3}"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Warning: this script targets Apple Silicon Macs; continuing anyway." >&2
fi

if ! command -v brew >/dev/null; then
  echo "Homebrew is required: https://brew.sh" >&2
  exit 1
fi

# uv manages Python and the per-engine environments; ffmpeg makes MP3s;
# espeak-ng lets Kokoro pronounce words missing from its dictionary.
brew list uv >/dev/null 2>&1 || brew install uv
brew list ffmpeg >/dev/null 2>&1 || brew install ffmpeg
brew list espeak-ng >/dev/null 2>&1 || brew install espeak-ng

echo "==> Engine API"
(cd "$ROOT/engine" && uv sync)

IFS=',' read -ra LIST <<< "$ENGINES"
for engine in "${LIST[@]}"; do
  echo "==> Worker: $engine"
  (cd "$ROOT/workers/$engine" && uv sync --frozen)
done

echo
echo "Done. Start the engine with:"
echo "  cd $ROOT/engine && NARRATOR_ENGINES=$ENGINES uv run narrator-engine serve"
echo "Models download from Hugging Face on first use (Kokoro ~0.3 GB, Chatterbox ~3 GB, Qwen3-TTS ~4.5 GB)."
