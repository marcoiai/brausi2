#!/usr/bin/env bash

set -eu

OS_NAME="$(uname -s)"
DISPLAY_ID="${DISPLAY_ID:-:99}"
RESOLUTION="${RESOLUTION:-800x600x24}"
LIVE_FILE="${LIVE_FILE:-./live.png}"
TMP_FILE="${TMP_FILE:-/tmp/live.tmp.png}"
CHAFA_SIZE="${CHAFA_SIZE:-200x80}"
SLEEP_TIME="${SLEEP_TIME:-0.2}"
ERR_FILE="${ERR_FILE:-/tmp/stream2.err}"

capture_linux() {
  export DISPLAY="$DISPLAY_ID"

  if ! pgrep -f "Xvfb $DISPLAY_ID" >/dev/null; then
    echo "Subindo Xvfb em $DISPLAY_ID com $RESOLUTION..."
    Xvfb "$DISPLAY_ID" -screen 0 "$RESOLUTION" -ac -nolisten tcp &
    sleep 1
  fi

  if ! xdpyinfo -display "$DISPLAY_ID" >/dev/null 2>&1; then
    echo "ERRO: display $DISPLAY_ID não está respondendo."
    echo "Veja: pgrep -a Xvfb"
    exit 1
  fi

  DISPLAY="$DISPLAY_ID" scrot "$TMP_FILE" 2>"$ERR_FILE"
}

capture_macos() {
  screencapture -x "$TMP_FILE" 2>"$ERR_FILE"
}

print_intro() {
  if [ "$OS_NAME" = "Linux" ]; then
    echo "Capturando $DISPLAY_ID e exibindo com chafa."
    echo "Abra algum app nesse display em outro terminal, exemplo:"
    echo "  DISPLAY=$DISPLAY_ID xclock &"
  else
    echo "Capturando a tela atual do macOS e exibindo com chafa."
    echo "Abra a janela que você quer espelhar antes de iniciar."
  fi

  echo
  echo "Parar: Ctrl+C"
  sleep 2
}

show_failure() {
  clear
  echo "Falha na captura."
  echo
  cat "$ERR_FILE" 2>/dev/null || true

  if [ "$OS_NAME" = "Linux" ]; then
    echo
    echo "Xvfb:"
    pgrep -a Xvfb || true
    echo
    echo "DISPLAY atual: ${DISPLAY:-}"
  fi
}

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
    chafa --symbols=block --size="$CHAFA_SIZE" "$LIVE_FILE"
  else
    show_failure
  fi

  sleep "$SLEEP_TIME"
done
