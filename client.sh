#!/usr/bin/env bash

set -eu

OS_NAME="$(uname -s)"
DISPLAY_ID="${DISPLAY_ID:-:99}"
RESOLUTION="${RESOLUTION:-512x384x24}"
LIVE_FILE="${LIVE_FILE:-./live.png}"
TMP_FILE="${TMP_FILE:-/tmp/live.tmp.png}"
CHAFA_SIZE="${CHAFA_SIZE:-64x22}"
SLEEP_TIME="${SLEEP_TIME:-0.5}"
ERR_FILE="${ERR_FILE:-/tmp/client.err}"

capture_linux() {
  export DISPLAY="$DISPLAY_ID"

  if ! command -v scrot >/dev/null 2>&1; then
    echo "[client] Missing dependency: scrot"
    exit 1
  fi

  if ! command -v xdpyinfo >/dev/null 2>&1; then
    echo "[client] Missing dependency: xdpyinfo"
    exit 1
  fi

  if ! pgrep -f "Xvfb $DISPLAY_ID" >/dev/null 2>&1; then
    echo "[client] No Xvfb found on $DISPLAY_ID. Run ./server.sh first."
    exit 1
  fi

  if ! xdpyinfo -display "$DISPLAY_ID" >/dev/null 2>&1; then
    echo "[client] Display $DISPLAY_ID is not responding. Run ./server.sh first."
    exit 1
  fi

  DISPLAY="$DISPLAY_ID" scrot "$TMP_FILE" 2>"$ERR_FILE"
}

capture_macos() {
  screencapture -x "$TMP_FILE" 2>"$ERR_FILE"
}

print_intro() {
  echo "[client] Role: terminal viewer client"
  if [ "$OS_NAME" = "Linux" ]; then
    echo "[client] DISPLAY=$DISPLAY_ID"
    echo "[client] Expecting server on the same display. Start ./server.sh first."
  else
    echo "[client] DISPLAY=system screen capture"
    echo "[client] Capturing the active macOS screen with screencapture."
  fi

  echo "[client] Resolution=$RESOLUTION Chafa=$CHAFA_SIZE Sleep=${SLEEP_TIME}s"
  echo
  echo "Stop: Ctrl+C"
  sleep 1
}

show_failure() {
  clear
  echo "[client] Capture failed."
  echo
  cat "$ERR_FILE" 2>/dev/null || true

  if [ "$OS_NAME" = "Linux" ]; then
    echo
    echo "[client] Xvfb:"
    pgrep -a Xvfb || true
    echo
    echo "[client] DISPLAY atual: ${DISPLAY:-}"
  fi
}

if ! command -v chafa >/dev/null 2>&1; then
  echo "[client] Missing dependency: chafa"
  exit 1
fi

rm -f "$LIVE_FILE" "$TMP_FILE" "$ERR_FILE"
print_intro

while true; do
  if [ "$OS_NAME" = "Linux" ]; then
    capture_linux
  else
    capture_macos
  fi

  if [ -f "$TMP_FILE" ]; then
    mv -f "$TMP_FILE" "$LIVE_FILE"
    clear
    chafa --colors full --size="$CHAFA_SIZE" "$LIVE_FILE"
  else
    show_failure
  fi

  sleep "$SLEEP_TIME"
done
