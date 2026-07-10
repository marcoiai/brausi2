#!/bin/sh

# --- CONFIGURATION (DESKTOP PROPORTIONS) ---
URL="https://ycombinator.com"
OUTPUT_PATH="$HOME/live.png"
WIDTH=120                 # Increased columns for high-density desktop canvas detail
MODE="symbols"            
WINDOW_SIZE="1280,800"    # Crisp widescreen desktop resolution canvas
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Clean up any leftover artifacts from past runs
rm -f "$OUTPUT_PATH"

# --- BULLETPROOF CLEANUP ENGINE ---
cleanup() {
    trap - INT TERM EXIT
    echo ""
    echo "Stopping desktop browser engine and clearing memory..."
    
    if [ -n "$CHROME_PID" ]; then
        kill -9 "$CHROME_PID" 2>/dev/null
    fi
    
    pkill -9 -f "Google Chrome.*--headless=new.*$WINDOW_SIZE" 2>/dev/null
    stty sane
    exit 0
}

trap cleanup INT TERM EXIT

# --- ASYNCHRONOUS CAPTURE FUNCTION ---
trigger_screenshot() {
    "$CHROME_PATH" \
        --headless=new \
        --no-sandbox \
        --screenshot="$OUTPUT_PATH" \
        --window-size="$WINDOW_SIZE" \
        --disable-gpu \
        "$URL" >/dev/null 2>&1 &
    CHROME_PID=$!
}

echo "Starting Headless Desktop Browser engine..."
echo "Waiting for the first page render to write to disk..."

trigger_screenshot

while [ ! -f "$OUTPUT_PATH" ]; do 
    sleep 0.2
done

render_screen() {
    clear
    echo "=== DESKTOP INTERACTIVE BROWSER ==="
    echo "URL: ${URL}"
    echo "Size: ${WIDTH}px | Mode: ${MODE} | Refreshed: $(date +%H:%M:%S)"
    echo "------------------------------------------------------------------------------------------------------------------------"
    
    if [ "$MODE" = "pixels" ]; then
        chafa --size "${WIDTH}x" -c full "$OUTPUT_PATH" 2>/dev/null
    else
        chafa --size "${WIDTH}x" --symbols block+border+space "$OUTPUT_PATH" 2>/dev/null
    fi
    
    echo "------------------------------------------------------------------------------------------------------------------------"
    echo "[+] Zoom In | [-] Zoom Out | [m] Toggle | [u] URL | [q] Quit"
}

LAST_MOD=$(stat -f "%m" "$OUTPUT_PATH")

stty sane
if command -v tput >/dev/null 2>&1; then tput flush; fi

render_screen

# --- MAIN INTERACTIVE KEYBOARD LOOP ---
while true; do
    if [ -f "$OUTPUT_PATH" ]; then
        CURRENT_MOD=$(stat -f "%m" "$OUTPUT_PATH")
        if [ "$CURRENT_MOD" != "$LAST_MOD" ]; then
            render_screen
            LAST_MOD=$CURRENT_MOD
        fi
    fi

    input=""
    read -t 1 -n 1 input 2>/dev/null
    status=$?

    if [ $status -gt 128 ]; then
        continue
    fi

    if [ -z "$input" ] || [ "$input" = " " ]; then
        continue
    fi

    case "$input" in
        +)
            WIDTH=$((WIDTH + 10))
            render_screen
            ;;
        -)
            if [ $WIDTH -gt 20 ]; then WIDTH=$((WIDTH - 10)); fi
            render_screen
            ;;
        m|M)
            if [ "$MODE" = "pixels" ]; then MODE="symbols"; else MODE="pixels"; fi
            render_screen
            ;;
        u|U)
            echo ""
            echo -n "🌐 Go to URL: "
            read new_url
            
            if [ -n "$new_url" ]; then
                first_chars=$(echo "$new_url" | head -c 4)
                if [ "$first_chars" != "http" ]; then
                    new_url="https://$new_url"
                fi
                
                URL="$new_url"
                echo "Loading layout layer..."
                trigger_screenshot
            else
                render_screen
            fi
            ;;
        q|Q)
            break
            ;;
    esac
done

cleanup
