#!/usr/bin/env bash

set -eu

DISPLAY_ID="${DISPLAY_ID:-:99}"
RESOLUTION="${RESOLUTION:-512x384x24}"
START_URL="${START_URL:-about:blank}"
ERR_FILE="${ERR_FILE:-/tmp/server.err}"

find_browser_bin() {
  if [ -n "${BROWSER_BIN:-}" ]; then
    printf '%s\n' "$BROWSER_BIN"
    return 0
  fi

  local candidate
  for candidate in chromium chromium-browser google-chrome google-chrome-stable; do
    if command -v "$candidate" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

require_linux() {
  if [ "$(uname -s)" != "Linux" ]; then
    echo "[server] Linux only. This script owns Xvfb and the browser app side."
    exit 1
  fi
}

start_xvfb() {
  if ! command -v Xvfb >/dev/null 2>&1; then
    echo "[server] Missing dependency: Xvfb"
    exit 1
  fi

  if ! command -v xdpyinfo >/dev/null 2>&1; then
    echo "[server] Missing dependency: xdpyinfo"
    exit 1
  fi

  if ! pgrep -f "Xvfb $DISPLAY_ID" >/dev/null 2>&1; then
    echo "[server] Starting Xvfb on $DISPLAY_ID with $RESOLUTION"
    Xvfb "$DISPLAY_ID" -screen 0 "$RESOLUTION" -ac -nolisten tcp >"$ERR_FILE" 2>&1 &
    sleep 1
  else
    echo "[server] Reusing existing Xvfb on $DISPLAY_ID"
  fi

  if ! xdpyinfo -display "$DISPLAY_ID" >/dev/null 2>&1; then
    echo "[server] Display $DISPLAY_ID is not responding"
    cat "$ERR_FILE" 2>/dev/null || true
    exit 1
  fi
}

launch_browser() {
  local browser_bin
  if ! browser_bin="$(find_browser_bin)"; then
    echo "[server] No supported browser found. Set BROWSER_BIN explicitly."
    exit 1
  fi

  local -a browser_args
  browser_args=(
    --disable-gpu
    --disable-dev-shm-usage
    --disable-background-networking
    --disable-background-timer-throttling
    --disable-renderer-backgrounding
    --no-first-run
    --no-default-browser-check
    --user-data-dir=/tmp/brausi2-chromium-profile
  )

  echo "[server] Role: display/app server"
  echo "[server] DISPLAY=$DISPLAY_ID"
  echo "[server] Browser=$browser_bin"
  echo "[server] URL=$START_URL"

  exec env DISPLAY="$DISPLAY_ID" "$browser_bin" "${browser_args[@]}" "$START_URL"
}

require_linux
start_xvfb
launch_browser
