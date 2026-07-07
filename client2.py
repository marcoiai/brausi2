import sys
import os
import json
import asyncio
import threading
import websockets
from PIL import Image
import io
import termios
import tty
import select
import atexit
import shutil
import subprocess

RESET = "\033[0m"
CLEAR = "\033[2J\033[H"
ERASE_TO_EOL = "\033[K"
HIDE_CURSOR = "\033[?25l"
SHOW_CURSOR = "\033[?25h"
ENABLE_MOUSE = "\033[?1000h\033[?1002h\033[?1006h"
DISABLE_MOUSE = "\033[?1000l\033[?1002l\033[?1006l"
DISABLE_WRAP = "\033[?7l"
ENABLE_WRAP = "\033[?7h"

FOOTER_LINES = 3
DEFAULT_BROWSER_WIDTH = 1280
DEFAULT_BROWSER_HEIGHT = 900
DEFAULT_WIDTH_PADDING = 0

input_queue = None
main_loop = None
original_terminal_settings = None
terminal_lock = threading.Lock()
nav_mode = False
nav_buffer = ""
running = True
chafa_path = None
renderer_mode = "ansi"
connection_state = "connecting"
last_error = ""


def render_frame(image_bytes):
    global renderer_mode

    if chafa_path:
        if render_frame_with_chafa(image_bytes):
            renderer_mode = "chafa"
            return

    renderer_mode = "ansi"
    render_frame_to_ansi(image_bytes)


def render_frame_with_chafa(image_bytes):
    try:
        target_width, content_lines = render_area()
        command = [
            chafa_path,
            "--probe",
            "off",
            "--format",
            os.environ.get("CHAFA_FORMAT", "symbols"),
            "--colors",
            os.environ.get("CHAFA_COLORS", "full"),
            "--size",
            f"{target_width}x{content_lines}",
            "--stretch",
            "--animate",
            "off",
            "--margin-right",
            "0",
            "--margin-bottom",
            "0",
            "--relative",
            "off",
        ]

        symbols = os.environ.get("CHAFA_SYMBOLS")
        if symbols:
            command.extend(["--symbols", symbols])

        command.append("-")

        result = subprocess.run(
            command,
            input=image_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if result.returncode != 0 or not result.stdout:
            return False

        frame = result.stdout.decode("utf-8", errors="ignore").replace("\n", "\r\n")
        output = f"{CLEAR}{frame}{RESET}{ERASE_TO_EOL}\r\n{status_line()}"
        with terminal_lock:
            sys.stdout.write(output)
            sys.stdout.flush()
        return True
    except Exception:
        return False


def render_frame_to_ansi(image_bytes):
    try:
        img = Image.open(io.BytesIO(image_bytes))
        target_width, content_lines = render_area()
        target_height = max(10, content_lines * 2)

        img = img.resize((target_width, target_height), Image.Resampling.BILINEAR)
        img = img.convert("RGB")
        pixels = img.load()

        output = [CLEAR]
        for y in range(0, img.height, 2):
            for x in range(img.width):
                r1, g1, b1 = pixels[x, y]
                r2, g2, b2 = pixels[x, y + 1] if y + 1 < img.height else (0, 0, 0)
                output.append(f"\033[38;2;{r2};{g2};{b2};48;2;{r1};{g1};{b1}m▄")
            output.append(f"{RESET}{ERASE_TO_EOL}\r\n")

        output.append(status_line())
        with terminal_lock:
            sys.stdout.write("".join(output))
            sys.stdout.flush()
    except Exception:
        pass


def status_line():
    status = f"[Carbonyl-Lite/{renderer_mode}] {connection_state}"
    if last_error:
        status = f"{status} | {last_error}"

    if nav_mode:
        return (
            f"{RESET}\033[1;33mURL: \033[0m{nav_buffer}{ERASE_TO_EOL}\r\n"
            f"Enter: go | Esc: cancel | {status}{ERASE_TO_EOL}\r\n"
        )

    return (
        f"{RESET}{status} | TAB: URL | Left/Right: History | "
        f"Click terminal image | Type to interact{ERASE_TO_EOL}\r\n"
    )


def terminal_size():
    try:
        return os.get_terminal_size()
    except OSError:
        return os.terminal_size((120, 40))


def render_area():
    term_columns, term_lines = terminal_size()
    width_padding = max(0, parse_int_env("BRAUSI_WIDTH_PADDING", DEFAULT_WIDTH_PADDING))
    target_width = max(10, term_columns - width_padding)
    content_lines = max(1, term_lines - FOOTER_LINES)
    return target_width, content_lines


def browser_size():
    width = parse_int_env("BROWSER_WIDTH", DEFAULT_BROWSER_WIDTH)
    height = parse_int_env("BROWSER_HEIGHT", DEFAULT_BROWSER_HEIGHT)
    return width, height


def parse_int_env(name, fallback):
    try:
        return int(os.environ.get(name, ""))
    except ValueError:
        return fallback


def resolve_chafa_path():
    if os.environ.get("CHAFA_ENABLED", "1") == "0":
        return None

    configured_path = os.environ.get("CHAFA_PATH")
    if configured_path:
        return configured_path

    return shutil.which("chafa")


def queue_event(event):
    if input_queue and main_loop and running:
        asyncio.run_coroutine_threadsafe(input_queue.put(event), main_loop)


def handle_mouse_sequence(sequence):
    if not sequence.startswith("\033[<"):
        return

    final = sequence[-1]
    if final != "M":
        return

    payload = sequence[3:-1]
    try:
        button_code_text, col_text, row_text = payload.split(";")
        button_code = int(button_code_text)
        col = int(col_text)
        row = int(row_text)
    except ValueError:
        return

    # SGR button 0 is left button press. Ignore drag, wheel, and release events.
    if (button_code & 3) != 0 or (button_code & 32) != 0 or (button_code & 64) != 0:
        return

    render_columns, content_lines = render_area()
    if row < 1 or row > content_lines or col < 1 or col > render_columns:
        return

    width, height = browser_size()
    browser_x = int((col - 1) / max(1, render_columns - 1) * width)
    browser_y = int((row - 1) / max(1, content_lines - 1) * height)
    queue_event({"type": "click", "x": browser_x, "y": browser_y})


def handle_escape_sequence(sequence):
    global nav_mode, nav_buffer

    if sequence.startswith("\033[<"):
        handle_mouse_sequence(sequence)
        return

    if nav_mode and sequence == "\033":
        nav_mode = False
        nav_buffer = ""
        return

    key_map = {
        "\033[A": "ArrowUp",
        "\033[B": "ArrowDown",
        "\033[C": "ArrowRight",
        "\033[D": "ArrowLeft",
    }

    if sequence == "\033[D":
        queue_event({"type": "history", "direction": "back"})
        return

    if sequence == "\033[C":
        queue_event({"type": "history", "direction": "forward"})
        return

    key = key_map.get(sequence)
    if key:
        queue_event({"type": "key", "key": key})


def handle_character(char):
    global nav_mode, nav_buffer, running

    if char == "\x03":
        running = False
        restore_terminal()
        raise KeyboardInterrupt

    if char == "\t" and not nav_mode:
        nav_mode = True
        nav_buffer = ""
        return

    if nav_mode:
        handle_nav_character(char)
        return

    if char in ("\r", "\n"):
        queue_event({"type": "key", "key": "Enter"})
    elif char in ("\x7f", "\b"):
        queue_event({"type": "key", "key": "Backspace"})
    elif char == " ":
        queue_event({"type": "text", "text": " "})
    elif char.isprintable():
        queue_event({"type": "text", "text": char})


def handle_nav_character(char):
    global nav_mode, nav_buffer

    if char in ("\r", "\n"):
        target_url = nav_buffer.strip()
        if target_url:
            queue_event({"type": "navigate", "url": target_url})
        nav_mode = False
        nav_buffer = ""
        return

    if char in ("\x7f", "\b"):
        nav_buffer = nav_buffer[:-1]
        return

    if char == "\x1b":
        nav_mode = False
        nav_buffer = ""
        return

    if char.isprintable():
        nav_buffer += char


def read_escape_sequence(first_char):
    sequence = [first_char]
    fd = sys.stdin.fileno()

    while select.select([sys.stdin], [], [], 0.01)[0]:
        next_byte = os.read(fd, 1)
        if not next_byte:
            break
        next_char = next_byte.decode("utf-8", errors="ignore")
        sequence.append(next_char)
        if next_char in ("M", "m"):
            break
        if len(sequence) >= 16 and not "".join(sequence).startswith("\033[<"):
            break

    return "".join(sequence)


def input_thread():
    fd = sys.stdin.fileno()

    while running:
        try:
            raw = os.read(fd, 1)
            if not raw:
                continue

            char = raw.decode("utf-8", errors="ignore")
            if char == "\x1b":
                handle_escape_sequence(read_escape_sequence(char))
            else:
                handle_character(char)
        except KeyboardInterrupt:
            break
        except Exception:
            continue


def setup_terminal():
    global original_terminal_settings

    if not sys.stdin.isatty():
        return

    original_terminal_settings = termios.tcgetattr(sys.stdin.fileno())
    tty.setraw(sys.stdin.fileno())
    with terminal_lock:
        sys.stdout.write(HIDE_CURSOR + DISABLE_WRAP + ENABLE_MOUSE + CLEAR)
        sys.stdout.flush()


def restore_terminal():
    if original_terminal_settings is not None:
        termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, original_terminal_settings)

    with terminal_lock:
        sys.stdout.write(DISABLE_MOUSE + ENABLE_WRAP + SHOW_CURSOR + RESET + "\r\n")
        sys.stdout.flush()


async def send_user_actions(websocket):
    while True:
        event = await input_queue.get()
        try:
            await websocket.send(json.dumps(event))
        except Exception:
            pass
        finally:
            input_queue.task_done()


async def receive_stream():
    global connection_state, last_error
    uri = os.environ.get("BROWSER_WS_URL", "ws://localhost:3001")

    while running:
        try:
            connection_state = f"connecting {uri}"
            last_error = ""
            async with websockets.connect(uri) as websocket:
                connection_state = f"connected {uri}"
                sender_task = asyncio.create_task(send_user_actions(websocket))
                try:
                    async for message in websocket:
                        render_frame(message)
                finally:
                    sender_task.cancel()
        except (websockets.exceptions.ConnectionClosedError, ConnectionRefusedError, OSError):
            connection_state = f"waiting {uri}"
            last_error = "no stream"
            with terminal_lock:
                sys.stdout.write(f"{CLEAR}{status_line()}")
                sys.stdout.flush()
            await asyncio.sleep(0.2)


if __name__ == "__main__":
    chafa_path = resolve_chafa_path()
    renderer_mode = "chafa" if chafa_path else "ansi"
    main_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(main_loop)
    input_queue = asyncio.Queue()

    setup_terminal()
    atexit.register(restore_terminal)

    if sys.stdin.isatty():
        threading.Thread(target=input_thread, daemon=True).start()

    with terminal_lock:
        sys.stdout.write(f"{CLEAR}{status_line()}")
        sys.stdout.flush()

    try:
        main_loop.run_until_complete(receive_stream())
    except KeyboardInterrupt:
        pass
    finally:
        restore_terminal()
