#!/bin/bash

# Target web URL to snapshot
URL="https://ycombinator.com"
OUTPUT_PATH="$HOME/live.png"
WINDOW_SIZE="1280,800"

# --- CROSS-PLATFORM BINARY DETECTION ---
find_chrome_binary() {
    # 1. Check macOS app package bundle
    if [ -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
        echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        return
    fi

    # 2. Check general Linux terminal binary variants in system PATH
    for binary in google-chrome google-chrome-stable chromium-browser chromium; do
        if command -v "$binary" &> /dev/null; then
            command -v "$binary"
            return
        fi
    done

    # 3. Last resort check for direct local installations
    if [ -f "/opt/google/chrome/chrome" ]; then
        echo "/opt/google/chrome/chrome"
        return
    fi

    echo ""
}

CHROME_PATH=$(find_chrome_binary)

if [ -z "$CHROME_PATH" ]; then
    echo "Error: Google Chrome or Chromium could not be automatically located."
    echo "Please install it via your system package manager (e.g., apt, dnf, pacman, or brew)."
    exit 1
fi

echo "Operating System: $(uname -s)"
echo "Found Chrome Binary: $CHROME_PATH"
echo "Streaming: $URL -> $OUTPUT_PATH"
echo "Press [Ctrl + C] to terminate loop."
echo "------------------------------------------------"

while true; do
    # Run Chrome headlessly, snapshot target, and discard window warnings
    "$CHROME_PATH" \
        --headless=new \
        --screenshot="$OUTPUT_PATH" \
        --window-size="$WINDOW_SIZE" \
        --disable-gpu \
        "$URL" &> /dev/null

    echo "Captured screenshot at $(date +%H:%M:%S)"
    
    # Wait budget between screenshot updates
    sleep 5
done

