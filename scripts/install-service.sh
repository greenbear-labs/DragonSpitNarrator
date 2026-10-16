#!/usr/bin/env bash
# Run the engine in the background at login on macOS (launchd). Re-run to update; pass --remove to uninstall.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.greenbearlabs.narrator-engine"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/.dragonspit-narrator/logs"
ENGINES="${NARRATOR_ENGINES:-kokoro,chatterbox,qwen3}"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [[ "${1:-}" == "--remove" ]]; then
  rm -f "$PLIST"
  echo "Removed $LABEL"
  exit 0
fi

UV="$(command -v uv)"
mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$UV</string><string>run</string><string>--project</string><string>$ROOT/engine</string>
    <string>narrator-engine</string><string>serve</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$UV"):/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>NARRATOR_ENGINES</key><string>$ENGINES</string>
  </dict>
  <key>WorkingDirectory</key><string>$ROOT/engine</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/engine.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/engine.log</string>
</dict>
</plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL. Logs: $LOG_DIR/engine.log"
