#!/usr/bin/env python3
"""
AutoFlow Engine - Headless automation worker.
Executes flow steps on an Android device via ADB.
"""
import sys
import json
import argparse
import time
import os
import subprocess
import re


def log(message):
    print(f"[ENGINE] {message}")
    sys.stdout.flush()


def adb(device_id, *args, timeout=30):
    """Run an ADB command and return stdout."""
    cmd = ["adb", "-s", device_id, *args]
    log(f"  -> ADB: {' '.join(cmd)}")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if result.returncode != 0 and result.stderr.strip():
            log(f"  -> ADB stderr: {result.stderr.strip()}")
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        log(f"  -> ADB command timed out after {timeout}s")
        return ""
    except FileNotFoundError:
        log(f"  -> ERROR: adb not found in PATH")
        return ""


def adb_shell(device_id, shell_cmd, timeout=30):
    """Run an ADB shell command."""
    return adb(device_id, "shell", shell_cmd, timeout=timeout)


def escape_adb_text(text):
    """Escape text for adb shell input text command.
    ADB input text doesn't handle spaces/special chars well,
    so we split by spaces and send them separately.
    """
    # Replace spaces with %s (ADB encoding for space)
    escaped = text.replace("'", "'\"'\"'")
    escaped = escaped.replace(" ", "%s")
    escaped = escaped.replace("&", "\\&")
    escaped = escaped.replace("<", "\\<")
    escaped = escaped.replace(">", "\\>")
    escaped = escaped.replace("|", "\\|")
    escaped = escaped.replace(";", "\\;")
    escaped = escaped.replace("(", "\\(")
    escaped = escaped.replace(")", "\\)")
    escaped = escaped.replace("$", "\\$")
    escaped = escaped.replace("`", "\\`")
    escaped = escaped.replace('"', '\\"')
    return escaped


def substitute_vars(value, variables):
    """Replace {{var_name}} placeholders with actual values."""
    if not isinstance(value, str):
        return value
    def replacer(match):
        key = match.group(1).strip()
        return variables.get(key, match.group(0))
    return re.sub(r"\{\{(.+?)\}\}", replacer, value)


def resolve_step(step, variables):
    """Deep-substitute variables in a step dict."""
    resolved = {}
    for k, v in step.items():
        if isinstance(v, str):
            resolved[k] = substitute_vars(v, variables)
        elif isinstance(v, list):
            resolved[k] = [substitute_vars(i, variables) if isinstance(i, str) else i for i in v]
        else:
            resolved[k] = v
    return resolved


# ─── Action Handlers ──────────────────────────────────────────

def action_open_app(device_id, step, flow_path):
    """Open an app by package name."""
    package = step.get("package", "")
    if not package:
        log("  -> ERROR: No package specified")
        return False
    adb_shell(device_id, f"monkey -p {package} -c android.intent.category.LAUNCHER 1")
    log(f"  -> Opened app: {package}")
    return True


def action_push_file(device_id, step, flow_path):
    """Push a file from PC to device."""
    local_path = step.get("local_path", "")
    remote_path = step.get("remote_path", "/sdcard/DCIM/AutoFlow/")

    if not local_path:
        log("  -> ERROR: No local_path specified")
        return False

    if not os.path.exists(local_path):
        log(f"  -> ERROR: File not found: {local_path}")
        return False

    # Ensure remote directory exists
    remote_dir = remote_path if remote_path.endswith("/") else os.path.dirname(remote_path)
    adb_shell(device_id, f"mkdir -p {remote_dir}")

    # If remote_path is a directory, append filename
    if remote_path.endswith("/"):
        filename = os.path.basename(local_path)
        remote_path = remote_path + filename

    adb(device_id, "push", local_path, remote_path, timeout=120)
    log(f"  -> Pushed: {local_path} -> {remote_path}")

    # Store the final remote path for later steps
    step["_pushed_remote_path"] = remote_path
    return True


def action_media_scan(device_id, step, flow_path):
    """Trigger Android media scanner for a file/directory."""
    path = step.get("path", "/sdcard/DCIM/AutoFlow/")
    adb_shell(device_id,
        f'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://{path}"')
    log(f"  -> Media scan triggered: {path}")
    # Also run broader scan
    adb_shell(device_id,
        f'content call --uri content://media --method scanFile --arg "{path}"')
    return True


def action_tap(device_id, step, flow_path):
    """Tap at specific x,y coordinates."""
    x = step.get("x", 0)
    y = step.get("y", 0)
    adb_shell(device_id, f"input tap {x} {y}")
    log(f"  -> Tapped at ({x}, {y})")
    return True


def action_long_press(device_id, step, flow_path):
    """Long press at specific x,y coordinates."""
    x = step.get("x", 0)
    y = step.get("y", 0)
    duration = step.get("duration", 1000)
    adb_shell(device_id, f"input swipe {x} {y} {x} {y} {duration}")
    log(f"  -> Long pressed at ({x}, {y}) for {duration}ms")
    return True


def action_type_text(device_id, step, flow_path):
    """Type text into the currently focused field."""
    text = step.get("text", "")
    if not text:
        log("  -> No text to type")
        return True

    # For multiline text or text with special chars, use ADB broadcast + clipboard
    # First try the clipboard approach for reliability
    use_clipboard = step.get("use_clipboard", False)

    if use_clipboard or len(text) > 100 or "\n" in text:
        # Use ADB broadcast to set clipboard, then paste
        # Requires Clipper app or Android 10+ clipboard service
        log(f"  -> Typing via clipboard method ({len(text)} chars)")
        # Use base64 approach for complex text
        import base64
        encoded = base64.b64encode(text.encode("utf-8")).decode("utf-8")
        adb_shell(device_id,
            f"am broadcast -a clipper.set -e text '{text}'")
        time.sleep(0.3)
        adb_shell(device_id, "input keyevent 279")  # KEYCODE_PASTE
    else:
        # Simple text - use input text with escaping
        escaped = escape_adb_text(text)
        adb_shell(device_id, f'input text "{escaped}"')

    log(f"  -> Typed: {text[:50]}{'...' if len(text) > 50 else ''}")
    return True


def action_type_multiline(device_id, step, flow_path):
    """Type text line by line with Enter keys between."""
    lines = step.get("lines", [])
    if isinstance(lines, str):
        lines = lines.split("\n")

    for i, line in enumerate(lines):
        if i > 0:
            adb_shell(device_id, "input keyevent 66")  # ENTER
            time.sleep(0.2)
        if line.strip():
            escaped = escape_adb_text(line.strip())
            adb_shell(device_id, f'input text "{escaped}"')
            time.sleep(0.3)

    log(f"  -> Typed {len(lines)} lines")
    return True


def action_clear_field(device_id, step, flow_path):
    """Clear the currently focused text field."""
    # Select all then delete
    adb_shell(device_id, "input keyevent 29 --longpress")  # CTRL+A
    time.sleep(0.1)
    adb_shell(device_id, "input keyevent 67")  # BACKSPACE/DELETE
    # Alternative: move to end, then delete everything
    for _ in range(200):
        adb_shell(device_id, "input keyevent 67")
    log("  -> Field cleared")
    return True


def action_swipe(device_id, step, flow_path):
    """Swipe gesture on screen."""
    direction = step.get("direction", "")
    duration = step.get("duration", 300)

    # Get screen size for calculated swipes
    # Default to common resolution
    w, h = 1080, 2340

    if direction == "up":
        x1, y1, x2, y2 = w // 2, h * 3 // 4, w // 2, h // 4
    elif direction == "down":
        x1, y1, x2, y2 = w // 2, h // 4, w // 2, h * 3 // 4
    elif direction == "left":
        x1, y1, x2, y2 = w * 3 // 4, h // 2, w // 4, h // 2
    elif direction == "right":
        x1, y1, x2, y2 = w // 4, h // 2, w * 3 // 4, h // 2
    else:
        # Custom coordinates
        x1 = step.get("x1", 0)
        y1 = step.get("y1", 0)
        x2 = step.get("x2", 0)
        y2 = step.get("y2", 0)

    adb_shell(device_id, f"input swipe {x1} {y1} {x2} {y2} {duration}")
    log(f"  -> Swiped {'(' + direction + ') ' if direction else ''}from ({x1},{y1}) to ({x2},{y2})")
    return True


def action_key_event(device_id, step, flow_path):
    """Send a key event."""
    keycode = step.get("keycode", "")
    # Support named keys
    key_map = {
        "back": "4", "home": "3", "recent": "187",
        "enter": "66", "tab": "61", "delete": "67",
        "volume_up": "24", "volume_down": "25",
        "power": "26", "camera": "27",
        "paste": "279", "copy": "278", "cut": "277",
        "select_all": "29",
    }
    code = key_map.get(str(keycode).lower(), str(keycode))
    adb_shell(device_id, f"input keyevent {code}")
    log(f"  -> Key event: {keycode} (code: {code})")
    return True


def action_back(device_id, step, flow_path):
    """Press back button."""
    adb_shell(device_id, "input keyevent 4")
    log("  -> Pressed BACK")
    return True


def action_wait(device_id, step, flow_path):
    """Wait for a duration."""
    duration = step.get("duration", 1)
    log(f"  -> Waiting {duration}s...")
    time.sleep(duration)
    return True


def action_click(device_id, step, flow_path):
    """Click on a template image using Airtest."""
    target = step.get("target", "")
    timeout = step.get("timeout", 15)
    threshold = step.get("threshold", 0.7)

    template_path = os.path.join(flow_path, target) if target else ""

    if not template_path or not os.path.exists(template_path):
        log(f"  -> Template not found: {template_path}")
        # Fallback to coordinates if provided
        if "x" in step and "y" in step:
            return action_tap(device_id, step, flow_path)
        return False

    try:
        from airtest.core.api import touch, wait, Template
        pos = wait(Template(template_path, threshold=threshold), timeout=timeout)
        if pos:
            touch(pos)
            log(f"  -> Clicked template: {target} at {pos}")
            return True
        else:
            log(f"  -> Template not found on screen: {target}")
            return False
    except ImportError:
        log(f"  -> Airtest not installed, cannot do template matching")
        if "x" in step and "y" in step:
            return action_tap(device_id, step, flow_path)
        return False
    except Exception as e:
        log(f"  -> Click failed: {e}")
        return False


def action_find_and_tap(device_id, step, flow_path):
    """Find a template and tap it. Alias for click."""
    return action_click(device_id, step, flow_path)


def action_assert_exists(device_id, step, flow_path):
    """Wait for a template to appear on screen."""
    target = step.get("target", "")
    timeout = step.get("timeout", 15)
    threshold = step.get("threshold", 0.7)
    template_path = os.path.join(flow_path, target) if target else ""

    try:
        from airtest.core.api import wait, Template
        pos = wait(Template(template_path, threshold=threshold), timeout=timeout)
        if pos:
            log(f"  -> Found: {target} at {pos}")
            return True
        log(f"  -> Not found: {target}")
        return False
    except ImportError:
        log(f"  -> Airtest not installed, skipping assertion")
        return True
    except Exception as e:
        log(f"  -> Assert failed: {e}")
        return False


def action_screenshot(device_id, step, flow_path):
    """Take a screenshot and save locally."""
    output = step.get("output", "screenshot.png")
    output_path = os.path.join(flow_path, output)
    adb(device_id, "exec-out", "screencap", "-p", timeout=10)
    # Use shell redirect approach
    subprocess.run(
        f'adb -s {device_id} exec-out screencap -p > "{output_path}"',
        shell=True, timeout=15
    )
    log(f"  -> Screenshot saved: {output_path}")
    return True


def action_sleep_until(device_id, step, flow_path):
    """Wait until a template appears or timeout."""
    target = step.get("target", "")
    timeout = step.get("timeout", 30)
    interval = step.get("interval", 2)
    template_path = os.path.join(flow_path, target) if target else ""

    elapsed = 0
    while elapsed < timeout:
        try:
            from airtest.core.api import exists, Template
            if exists(Template(template_path, threshold=0.7)):
                log(f"  -> Found {target} after {elapsed}s")
                return True
        except ImportError:
            log(f"  -> Airtest not installed, waiting full timeout")
            time.sleep(timeout)
            return True
        except Exception:
            pass
        time.sleep(interval)
        elapsed += interval
        log(f"  -> Still waiting for {target}... ({elapsed}/{timeout}s)")

    log(f"  -> Timeout waiting for {target}")
    return step.get("optional", False)


def action_select_gallery_item(device_id, step, flow_path):
    """Tap the first/Nth item in a gallery grid.
    Common pattern: gallery grids start at a known offset.
    """
    index = step.get("index", 0)  # 0 = first item
    # Default grid layout assumptions (3 columns)
    cols = step.get("cols", 3)
    grid_top = step.get("grid_top", 400)
    cell_width = step.get("cell_width", 360)
    cell_height = step.get("cell_height", 360)
    margin = step.get("margin", 0)

    row = index // cols
    col = index % cols

    x = (col * (cell_width + margin)) + (cell_width // 2)
    y = grid_top + (row * (cell_height + margin)) + (cell_height // 2)

    adb_shell(device_id, f"input tap {x} {y}")
    log(f"  -> Tapped gallery item #{index} at ({x}, {y})")
    return True


def action_launch_intent(device_id, step, flow_path):
    """Launch a specific Android intent."""
    intent = step.get("intent", "")
    if not intent:
        log("  -> ERROR: No intent specified")
        return False
    adb_shell(device_id, f"am start {intent}")
    log(f"  -> Launched intent: {intent}")
    return True


def action_kill_app(device_id, step, flow_path):
    """Force stop an app."""
    package = step.get("package", "")
    if package:
        adb_shell(device_id, f"am force-stop {package}")
        log(f"  -> Killed app: {package}")
    return True


# ─── Action Registry ──────────────────────────────────────────

ACTION_MAP = {
    "open_app": action_open_app,
    "push_file": action_push_file,
    "media_scan": action_media_scan,
    "tap": action_tap,
    "long_press": action_long_press,
    "type_text": action_type_text,
    "type_multiline": action_type_multiline,
    "clear_field": action_clear_field,
    "swipe": action_swipe,
    "key_event": action_key_event,
    "back": action_back,
    "wait": action_wait,
    "click": action_click,
    "find_and_tap": action_find_and_tap,
    "assert_exists": action_assert_exists,
    "screenshot": action_screenshot,
    "sleep_until": action_sleep_until,
    "select_gallery_item": action_select_gallery_item,
    "launch_intent": action_launch_intent,
    "kill_app": action_kill_app,
}


# ─── Flow Execution ──────────────────────────────────────────

def load_flow(flow_path):
    json_path = os.path.join(flow_path, "flow.json")
    if not os.path.exists(json_path):
        log(f"ERROR: flow.json not found at {json_path}")
        sys.exit(1)
    with open(json_path, "r") as f:
        return json.load(f)


def connect_device(device_id):
    """Connect to device - try airtest first, fall back to raw ADB."""
    try:
        from airtest.core.api import connect_device as airtest_connect
        airtest_connect(f"Android://127.0.0.1:5037/{device_id}")
        log("Connected via Airtest (template matching enabled)")
        return True
    except Exception as e:
        log(f"Airtest unavailable: {e}")

    # Verify ADB connectivity
    result = adb(device_id, "get-state")
    if "device" in result:
        log(f"Connected via ADB (raw mode)")
        return True
    else:
        log(f"WARNING: Device not responding. ADB state: {result}")
        log("Continuing anyway - some steps may fail")
        return False


def execute_steps(device_id, steps, flow_path, variables):
    """Run all steps once with given variables. Returns number of failed steps."""
    failed_steps = 0
    for i, raw_step in enumerate(steps):
        step = resolve_step(raw_step, variables)
        action = step.get("action", "unknown")
        description = step.get("description", action)
        optional = step.get("optional", False)
        step_num = i + 1

        log(f"[Step {step_num}/{len(steps)}] {description}")

        handler = ACTION_MAP.get(action)
        if not handler:
            log(f"  -> Unknown action: {action}, skipping")
            continue

        try:
            success = handler(device_id, step, flow_path)
            if not success and not optional:
                failed_steps += 1
                if step.get("stop_on_fail", False):
                    log(f"  -> FATAL: Step failed, stopping flow")
                    break
                log(f"  -> Step failed (non-fatal, continuing)")
            elif not success and optional:
                log(f"  -> Optional step skipped")
            else:
                log(f"  -> Step {step_num} complete")
        except Exception as e:
            log(f"  -> Exception: {e}")
            if not optional:
                failed_steps += 1
                if step.get("stop_on_fail", False):
                    break

        delay = step.get("delay_after", 0.5)
        if delay > 0:
            time.sleep(delay)
        log("")

    return failed_steps


def execute_flow(device_id, flow_path, variables):
    flow = load_flow(flow_path)
    flow_name = flow.get("name", "Unknown Flow")
    steps = flow.get("steps", [])
    is_batch = flow.get("batch", False)
    items = variables.get("items", [])

    log("=== AutoFlow Engine Started ===")
    log(f"Flow: {flow_name}")
    log(f"Device: {device_id}")
    log(f"Steps per run: {len(steps)}")

    if is_batch and items:
        log(f"Mode: BATCH ({len(items)} items in queue)")
    else:
        log(f"Mode: SINGLE")
    log("")

    connect_device(device_id)
    log("")

    if is_batch and items:
        # ─── Batch Mode: run flow for each item ───
        total = len(items)
        total_failed = 0
        delay_between = variables.get("delay_between_items", 5)

        for idx, item in enumerate(items):
            item_num = idx + 1
            log(f"╔══════════════════════════════════════════════╗")
            log(f"║  ITEM {item_num}/{total}")

            # Show item details
            for k, v in item.items():
                display = str(v)[:60] + ("..." if len(str(v)) > 60 else "")
                log(f"║  {k}: {display}")
            log(f"╚══════════════════════════════════════════════╝")
            log("")

            # Merge item fields into variables for this run
            run_vars = {**variables, **item}

            failed = execute_steps(device_id, steps, flow_path, run_vars)
            total_failed += failed

            if failed > 0:
                log(f"[ITEM {item_num}] Completed with {failed} failed steps")
            else:
                log(f"[ITEM {item_num}] Completed successfully")

            # Delay between items (skip after last)
            if idx < total - 1:
                log(f"")
                log(f"--- Waiting {delay_between}s before next item ---")
                time.sleep(delay_between)
                log("")

        log("")
        log(f"=== Batch complete: {total} items processed, {total_failed} total step failures ===")
    else:
        # ─── Single Mode ───
        log("--- Executing Steps ---")
        failed = execute_steps(device_id, steps, flow_path, variables)
        log(f"=== All {len(steps)} steps processed ({failed} failed) ===")

    log("=== AutoFlow Engine Finished ===")


def main():
    parser = argparse.ArgumentParser(description="AutoFlow Engine")
    parser.add_argument("--device", required=True, help="Android device ID")
    parser.add_argument("--flow_path", required=True, help="Path to the flow directory")
    parser.add_argument("--vars", default="{}", help="JSON string of variables")
    args = parser.parse_args()

    try:
        variables = json.loads(args.vars)
    except json.JSONDecodeError:
        log(f"WARNING: Invalid --vars JSON, using empty vars")
        variables = {}

    execute_flow(args.device, args.flow_path, variables)


if __name__ == "__main__":
    main()

