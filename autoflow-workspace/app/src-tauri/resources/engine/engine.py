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


ADB_PATH = "adb"


def log(message):
    print(f"[ENGINE] {message}")
    sys.stdout.flush()


def adb(device_id, *args, timeout=30):
    """Run an ADB command and return stdout."""
    cmd = [ADB_PATH, "-s", device_id, *args]
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


# ─── Screen Detection ────────────────────────────────────────

def get_current_activity(device_id):
    """Get the current foreground activity name.
    Checks multiple markers because format varies across Android versions:
    mResumedActivity / topResumedActivity (older), mFocusedApp (Android 12+).
    """
    result = adb(device_id, "shell", "dumpsys", "activity", "activities")
    markers = ("topResumedActivity", "mResumedActivity", "mFocusedApp")
    for line in result.splitlines():
        if any(m in line for m in markers):
            for part in line.strip().split():
                if "/" in part and "." in part:
                    return part.split("}")[0].strip()
    return ""


def wait_for_activity(device_id, expected, timeout=30, interval=2):
    """Wait until the expected activity is in the foreground."""
    elapsed = 0
    while elapsed < timeout:
        current = get_current_activity(device_id)
        if expected in current:
            log(f"  -> Activity matched: {current}")
            return True
        log(f"  -> Waiting for '{expected}'... current: {current} ({elapsed}/{timeout}s)")
        time.sleep(interval)
        elapsed += interval
    log(f"  -> Timeout waiting for activity '{expected}'")
    return False


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
    use_sendevent = step.get("sendevent", False)

    if use_sendevent:
        # Use raw sendevent for views that don't respond to input tap
        # (e.g. custom views requiring pressure/touch_major data)
        dev = "/dev/input/event4"
        cmds = (
            f"sendevent {dev} 3 57 999;"   # ABS_MT_TRACKING_ID
            f"sendevent {dev} 3 48 15;"    # ABS_MT_TOUCH_MAJOR
            f"sendevent {dev} 3 49 15;"    # ABS_MT_WIDTH_MAJOR
            f"sendevent {dev} 3 58 15;"    # ABS_MT_PRESSURE
            f"sendevent {dev} 3 53 {x};"   # ABS_MT_POSITION_X
            f"sendevent {dev} 3 54 {y};"   # ABS_MT_POSITION_Y
            f"sendevent {dev} 1 330 1;"    # BTN_TOUCH DOWN
            f"sendevent {dev} 0 0 0;"      # SYN_REPORT
            f"sleep 0.05;"
            f"sendevent {dev} 3 57 -1;"    # ABS_MT_TRACKING_ID (release)
            f"sendevent {dev} 1 330 0;"    # BTN_TOUCH UP
            f"sendevent {dev} 0 0 0"       # SYN_REPORT
        )
        adb_shell(device_id, cmds)
        log(f"  -> Tapped at ({x}, {y}) via sendevent (with pressure)")
    else:
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
    """Type text into the currently focused field.
    Splits text by # to handle hashtags properly:
    - Regular text: sent via 'input text' with %s for spaces
    - Hashtags (#word): sent via shell double-quote wrapping single-quote
    """
    text = step.get("text", "")
    if not text:
        log("  -> No text to type")
        return True

    # Split into segments: regular text and #hashtags
    # e.g. "Hello World #shopee #viral" → ["Hello World ", "#shopee ", "#viral"]
    import re
    segments = re.split(r'(#\S+)', text)

    for seg in segments:
        seg = seg.strip()
        if not seg:
            continue

        if seg.startswith('#'):
            # Add space before hashtag if not first segment
            adb_shell(device_id, 'input text "%s"')
            time.sleep(0.05)
            # Hashtag: must use subprocess with proper shell quoting
            hashtag = seg  # e.g. "#shopee"
            cmd = [ADB_PATH, "-s", device_id, "shell", f"input text '{hashtag}'"]
            log(f"  -> ADB: {' '.join(cmd)}")
            subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        else:
            # Regular text: use input text with space encoding
            escaped = escape_adb_text(seg)
            adb_shell(device_id, f'input text "{escaped}"')

        time.sleep(0.1)

    log(f"  -> Typed: {text[:60]}{'...' if len(text) > 60 else ''}")
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
    """Take a screenshot and save to device gallery (/sdcard/DCIM/AutoFlow_Shots/).
    Faster than pull-to-laptop and ends up in phone's gallery app automatically."""
    output = step.get("output", f"shot_{int(time.time())}.png")
    remote_dir = "/sdcard/DCIM/AutoFlow_Shots"
    remote_path = f"{remote_dir}/{output}"
    try:
        adb_shell(device_id, f"mkdir -p {remote_dir}")
        adb_shell(device_id, f"screencap -p {remote_path}", timeout=15)
        # Media scan so the new file appears in gallery apps
        adb_shell(device_id,
            f'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://{remote_path}"',
            timeout=5)
        log(f"  -> Screenshot saved on device: {remote_path}")
    except Exception as e:
        log(f"  -> Screenshot failed: {e}")
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


def action_shell_cmd(device_id, step, flow_path):
    """Run an arbitrary ADB shell command."""
    command = step.get("command", "")
    if not command:
        log("  -> ERROR: No command specified")
        return False
    result = adb_shell(device_id, command)
    if result:
        log(f"  -> Output: {result[:100]}")
    log(f"  -> Shell: {command}")
    return True


def _u2_selector(step, exclude=()):
    # Map JSON-schema selector names → uiautomator2 UiSelector kwargs.
    # `contentDescription` is our JSON name (avoids colliding with step-level
    # `description` log field); u2 expects `description`.
    # `exclude` lets callers (like u2_type) omit `text`, which for type actions
    # is the value to TYPE rather than a selector criterion.
    mapping = {
        "text": "text",
        "textContains": "textContains",
        "textStartsWith": "textStartsWith",
        "resourceId": "resourceId",
        "className": "className",
        "contentDescription": "description",
    }
    return {v: step[k] for k, v in mapping.items() if k not in exclude and step.get(k)}


def _u2_connect(device_id):
    try:
        import uiautomator2 as u2
    except ImportError:
        log("  -> ERROR: uiautomator2 not installed. Run: pip install uiautomator2")
        return None
    try:
        return u2.connect(device_id)
    except Exception as e:
        log(f"  -> u2 connect error: {e}")
        return None


def _selector_variants(step):
    """Produce progressive selector variants for cross-device resilience.

    Order (tightest → loosest):
      1. Primary: all selectors from step (text + resourceId + className + desc)
      2. No text: drop text constraint (text varies per Shopee version/locale)
      3. resourceIdMatches: strip plugin version suffix and match any variant
         (e.g. com.shopee.id.dfpluginshopee16:id/xxx → com.shopee.id.*:id/xxx)
      4. resourceId suffix only: match any package with same :id/xxx
         (last-resort when package name itself drifts)
    """
    import re
    primary = _u2_selector(step)
    variants = []
    if primary:
        variants.append(('primary', primary))
    # Variant 2: drop text
    if primary.get('text') or primary.get('textContains'):
        no_text = {k: v for k, v in primary.items() if k not in ('text', 'textContains', 'textStartsWith')}
        if no_text:
            variants.append(('no-text', no_text))
    # Variant 3 & 4: resourceId pattern variants
    rid = step.get('resourceId') or ''
    if rid and ':id/' in rid:
        pkg, short = rid.split(':id/', 1)
        # Variant 3: same base pkg (com.shopee.id) + any plugin suffix
        base = pkg.split('.dfplugin')[0] if '.dfplugin' in pkg else pkg
        if base != pkg:
            pattern = re.escape(base) + r'(\.dfplugin\w+)?' + ':id/' + re.escape(short)
            rid_match = {k: v for k, v in primary.items() if k != 'resourceId' and k not in ('text', 'textContains', 'textStartsWith')}
            rid_match['resourceIdMatches'] = pattern
            variants.append(('rid-base', rid_match))
        # Variant 4: any package, match by :id/<short> alone
        rid_any = {k: v for k, v in primary.items() if k != 'resourceId' and k not in ('text', 'textContains', 'textStartsWith')}
        rid_any['resourceIdMatches'] = r'.*:id/' + re.escape(short)
        variants.append(('rid-suffix', rid_any))
    return variants


def action_u2_click(device_id, step, flow_path):
    """Click a UI element using uiautomator2 with progressive selector fallback.

    Cross-device replay is fragile: Shopee's resourceId carries a plugin-version
    suffix (e.g. `.dfpluginshopee16`) and localized text strings that vary per
    app build. We try progressively looser selectors before giving up to a
    coord-based fallback.
    """
    def _try_fallback(reason):
        # Only attempt coord fallback when we have a verifiable transition;
        # otherwise silent fail is safer than tapping a random coord.
        has_wait_for = bool(step.get("wait_for"))
        if not has_wait_for:
            if step.get("optional"):
                log(f"  -> {reason}, step is optional — skipping (no wait_for to verify fallback)")
                return True
            log(f"  -> {reason}, no wait_for — skipping fallback (coord might hit wrong UI)")
            return False
        fb = step.get("fallback_tap_pct")
        if fb and (fb.get("x_pct") is not None or fb.get("x_abs") is not None):
            log(f"  -> {reason}, trying fallback coord")
            return action_tap_pct(device_id, fb, flow_path)
        if "x" in step and "y" in step:
            log(f"  -> {reason}, legacy fallback to tap ({step['x']}, {step['y']})")
            return action_tap(device_id, step, flow_path)
        return False

    d = _u2_connect(device_id)
    if d is None:
        return _try_fallback("u2 unavailable")

    variants = _selector_variants(step)
    if not variants:
        log("  -> ERROR: No selector provided for u2_click")
        return _try_fallback("no selector")

    timeout = step.get("timeout", 10)
    # Budget timeout across variants — spend most on first, less on fallbacks
    per_variant = [timeout, max(2, timeout // 3), 2, 2]

    for i, (name, selector) in enumerate(variants):
        try:
            el = d(**selector)
            t = per_variant[i] if i < len(per_variant) else 2
            if el.wait(timeout=t):
                el.click()
                tag = '' if name == 'primary' else f' (via {name})'
                log(f"  -> u2_click: clicked element{tag} {selector}")
                return True
            log(f"  -> u2_click: not found with {name} selector")
        except Exception as e:
            log(f"  -> u2_click {name} error: {e}")

    return _try_fallback("element not found with any selector variant")


def action_u2_type(device_id, step, flow_path):
    """Set text of a UI element via uiautomator2.
    Bypasses ADB `input text` entirely — works on fields that reject
    keyboard input (e.g. Shopee caption).
    """
    d = _u2_connect(device_id)
    if d is None:
        return False
    selector = _u2_selector(step, exclude=("text",))
    if not selector:
        log("  -> ERROR: No selector provided for u2_type")
        return False
    text = step.get("text", "")
    timeout = step.get("timeout", 10)
    clear = step.get("clear", True)
    try:
        el = d(**selector)
        if not el.wait(timeout=timeout):
            log(f"  -> u2_type: element not found {selector}")
            return False
        if clear:
            el.clear_text()
            el.set_text(text)
            log(f"  -> u2_type: set {len(text)} chars into {selector}")
        else:
            # Append: read existing + concat + set (set_text replaces, so must combine)
            try:
                existing = el.get_text() or ""
                hint = el.info.get("hint") or ""
            except Exception:
                existing, hint = "", ""
            if existing == hint:
                existing = ""  # hint shown as text when empty
            combined = existing + text
            el.set_text(combined)
            log(f"  -> u2_type: appended {len(text)} → total {len(combined)} chars into {selector}")
        return True
    except Exception as e:
        log(f"  -> u2_type error: {e}")
        return False


def action_u2_wait(device_id, step, flow_path):
    """Wait for a UI element to appear. Used for screen sync / assertions."""
    d = _u2_connect(device_id)
    if d is None:
        return False
    selector = _u2_selector(step)
    if not selector:
        log("  -> ERROR: No selector provided for u2_wait")
        return False
    timeout = step.get("timeout", 15)
    try:
        if d(**selector).wait(timeout=timeout):
            log(f"  -> u2_wait: element appeared {selector}")
            return True
        log(f"  -> u2_wait: timeout {timeout}s waiting for {selector}")
        return False
    except Exception as e:
        log(f"  -> u2_wait error: {e}")
        return False


def action_u2_scroll_to(device_id, step, flow_path):
    """Scroll a scrollable container until the element is visible."""
    d = _u2_connect(device_id)
    if d is None:
        return False
    selector = _u2_selector(step)
    if not selector:
        log("  -> ERROR: No selector provided for u2_scroll_to")
        return False
    try:
        found = d(scrollable=True).scroll.to(**selector)
        if found:
            log(f"  -> u2_scroll_to: reached {selector}")
            return True
        log(f"  -> u2_scroll_to: element not found after scrolling {selector}")
        return False
    except Exception as e:
        log(f"  -> u2_scroll_to error: {e}")
        return False


def action_tap_pct(device_id, step, flow_path):
    """Tap coord. Prefers pre-computed x_abs/y_abs (from smart scaling at convert
    time) over pct scaling (which miss for edge-region elements due to status
    bar drift between devices)."""
    x_abs = step.get("x_abs")
    y_abs = step.get("y_abs")
    if x_abs is not None and y_abs is not None:
        x, y = int(x_abs), int(y_abs)
        adb_shell(device_id, f"input tap {x} {y}")
        log(f"  -> tap_pct: x_abs/y_abs ({x}, {y})")
        return True
    x_pct = step.get("x_pct")
    y_pct = step.get("y_pct")
    if x_pct is None or y_pct is None:
        log("  -> ERROR: tap_pct needs x_pct/y_pct or x_abs/y_abs")
        return False
    try:
        wm = adb_shell(device_id, "wm size")
        parts = wm.split(":")[-1].strip().split("x")
        w, h = int(parts[0]), int(parts[1])
    except Exception as e:
        log(f"  -> tap_pct: wm size failed ({e}), defaulting to 1080x2400")
        w, h = 1080, 2400
    x = int(w * float(x_pct))
    y = int(h * float(y_pct))
    adb_shell(device_id, f"input tap {x} {y}")
    log(f"  -> tap_pct: ({x_pct}, {y_pct}) on {w}x{h} -> ({x}, {y})")
    return True


def action_u2_exists(device_id, step, flow_path):
    """Check presence of a UI element. `expect: false` flips the success condition."""
    d = _u2_connect(device_id)
    if d is None:
        return False
    selector = _u2_selector(step)
    if not selector:
        log("  -> ERROR: No selector provided for u2_exists")
        return False
    timeout = step.get("timeout", 3)
    expect = step.get("expect", True)
    try:
        found = d(**selector).exists(timeout=timeout)
        log(f"  -> u2_exists: {selector} -> {found} (expect {expect})")
        return found == expect
    except Exception as e:
        log(f"  -> u2_exists error: {e}")
        return False


def action_check_activity(device_id, step, flow_path):
    """Check current foreground activity. Useful for flow validation."""
    result = adb_shell(device_id,
        "dumpsys activity activities | grep mResumedActivity")
    log(f"  -> Current activity: {result.strip()}")
    expected = step.get("expected", "")
    if expected and expected not in result:
        log(f"  -> WARNING: Expected '{expected}' but got different activity")
        return step.get("optional", True)
    return True


def action_dismiss_popup(device_id, step, flow_path):
    """Try to dismiss a popup by tapping X/close button. Always succeeds (optional by nature)."""
    x = step.get("x", 0)
    y = step.get("y", 0)
    retries = step.get("retries", 1)
    for i in range(retries):
        adb_shell(device_id, f"input tap {x} {y}")
        log(f"  -> Dismiss tap #{i+1} at ({x}, {y})")
        delay = step.get("delay_between", 0.5)
        if delay > 0 and i < retries - 1:
            time.sleep(delay)
    return True


def action_skip_if_empty(device_id, step, flow_path):
    """Check if a field is empty — actual skip logic handled in execute_steps."""
    # This is a marker action; the real logic is in execute_steps
    return True


def action_scroll_to(device_id, step, flow_path):
    """Scroll in a direction N times. Useful for finding elements below fold."""
    direction = step.get("direction", "up")
    times = step.get("times", 1)
    duration = step.get("duration", 500)
    w, h = 1080, 2400
    for i in range(times):
        if direction == "up":
            x1, y1, x2, y2 = w // 2, h * 2 // 3, w // 2, h // 3
        elif direction == "down":
            x1, y1, x2, y2 = w // 2, h // 3, w // 2, h * 2 // 3
        else:
            x1 = step.get("x1", w // 2)
            y1 = step.get("y1", h * 2 // 3)
            x2 = step.get("x2", w // 2)
            y2 = step.get("y2", h // 3)
        adb_shell(device_id, f"input swipe {x1} {y1} {x2} {y2} {duration}")
        log(f"  -> Scroll {direction} #{i+1}")
        if i < times - 1:
            time.sleep(0.3)
    return True


# ─── Error Recovery ──────────────────────────────────────────

def check_and_recover_network_error(device_id):
    """Check if Shopee is showing 'Jaringan Tidak Tersedia' error.
    If found, tap 'Coba Lagi' button and wait for recovery.
    Returns True if error was found and recovery attempted.
    """
    # Check UI for network error text
    result = adb_shell(device_id, "uiautomator dump /dev/tty", timeout=10)
    if "Jaringan Tidak Tersedia" in result or "Coba Lagi" in result:
        log("  -> [RECOVERY] Network error detected: 'Jaringan Tidak Tersedia'")
        log("  -> [RECOVERY] Tapping 'Coba Lagi' button...")

        # Try u2 text click first
        try:
            import uiautomator2 as u2
            d = u2.connect(device_id)
            btn = d(text="Coba Lagi")
            if btn.exists(timeout=3):
                btn.click()
                log("  -> [RECOVERY] Tapped 'Coba Lagi' via uiautomator2")
                time.sleep(5)
                return True
        except Exception:
            pass

        # Fallback: tap by coordinates
        # Get actual screen size for accurate tap
        screen_w, screen_h = 1080, 2400
        try:
            wm = adb_shell(device_id, "wm size")
            if "x" in wm:
                parts = wm.split(":")[-1].strip().split("x")
                screen_w = int(parts[0])
                screen_h = int(parts[1])
        except Exception:
            pass

        # "Coba Lagi" button is centered horizontally, at ~55% of screen height
        tap_x = screen_w // 2
        tap_y = int(screen_h * 0.55)
        adb_shell(device_id, f"input tap {tap_x} {tap_y}")
        log(f"  -> [RECOVERY] Tapped 'Coba Lagi' at ({tap_x}, {tap_y})")
        time.sleep(5)
        return True

    return False


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
    "check_activity": action_check_activity,
    "dismiss_popup": action_dismiss_popup,
    "scroll_to": action_scroll_to,
    "tap_pct": action_tap_pct,
    "u2_click": action_u2_click,
    "u2_type": action_u2_type,
    "u2_wait": action_u2_wait,
    "u2_scroll_to": action_u2_scroll_to,
    "u2_exists": action_u2_exists,
    "skip_if_empty": action_skip_if_empty,
    "shell_cmd": action_shell_cmd,
}


# ─── Flow Execution ──────────────────────────────────────────

def load_flow(flow_path):
    json_path = os.path.join(flow_path, "flow.json")
    if not os.path.exists(json_path):
        log(f"ERROR: flow.json not found at {json_path}")
        sys.exit(1)
    with open(json_path, "r") as f:
        return json.load(f)


# ─── Signal-file based engine↔UI control (Sprint 4c) ────────────

SIGNAL_FILE = None  # set in main() from --signal_file arg

def wait_for_user_signal(timeout=60):
    """Block up to `timeout`s for UI to write a control signal.
    Returns 'resume' | 'skip' | 'abort' | 'timeout'."""
    global SIGNAL_FILE
    if not SIGNAL_FILE:
        return 'resume'  # no signal file configured — fail-open
    elapsed = 0
    while elapsed < timeout:
        try:
            if os.path.exists(SIGNAL_FILE):
                with open(SIGNAL_FILE, 'r') as f:
                    action = f.read().strip().lower()
                try: os.remove(SIGNAL_FILE)
                except Exception: pass
                if action in ('resume', 'skip', 'abort'):
                    log(f"  -> [SIGNAL] received: {action}")
                    return action
        except Exception as e:
            log(f"  -> [SIGNAL] read error: {e}")
        time.sleep(1)
        elapsed += 1
    log(f"  -> [SIGNAL] timeout after {timeout}s")
    return 'timeout'


def _is_launcher(activity: str) -> bool:
    """Launcher activities vary per OEM (QuickstepLauncher / OneUiHomeLauncher /
    NexusLauncherActivity / LauncherActivity, etc). Treat any Launcher* as home."""
    a = (activity or "").lower()
    return "launcher" in a


def check_expected_activity(device_id, step):
    """Verify phone is at step's expected_activity before running.
    Returns (ok: bool, current_activity: str).

    Launcher matching is lenient: if both expected and current are launcher-like,
    treat as match regardless of OEM-specific class name.
    """
    expected = step.get("expected_activity")
    if not expected:
        return True, ""
    current = get_current_activity(device_id)
    if expected in current:
        return True, current
    # Lenient launcher cross-match (different OEMs have different launcher names)
    if _is_launcher(expected) and _is_launcher(current):
        return True, current
    # Auto-recover: if expected is launcher but current isn't, try HOME key once
    if _is_launcher(expected) and not _is_launcher(current):
        log(f"  -> [AUTO-RECOVER] expected launcher but on {current} — sending HOME key")
        adb(device_id, "shell input keyevent KEYCODE_HOME")
        time.sleep(1.2)
        current = get_current_activity(device_id)
        if _is_launcher(current) or expected in current:
            log(f"  -> [AUTO-RECOVER] recovered to {current}")
            return True, current
    return False, current


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
    skip_to_phase = None
    for i, raw_step in enumerate(steps):
        step = resolve_step(raw_step, variables)
        action = step.get("action", "")

        # Skip phase markers (metadata-only steps)
        if not action or action == "unknown":
            phase = step.get("_phase", "")
            title = step.get("_title", "")
            # If we're skipping to a phase, check if we reached it
            if skip_to_phase and phase == skip_to_phase:
                skip_to_phase = None
                log(f"\n{title or f'--- Phase {phase} ---'}")
            elif skip_to_phase:
                continue
            elif phase or title:
                log(f"\n{title or f'--- Phase {phase} ---'}")
            continue

        # If we're skipping steps, skip until target phase
        if skip_to_phase:
            continue

        # Handle skip_if_empty: check field and skip to target phase
        if action == "skip_if_empty":
            field = step.get("field", "")
            value = variables.get(field, "")
            target = step.get("skip_to_phase", "")
            if not value or not str(value).strip():
                log(f"  -> Field '{field}' is empty, skipping to phase {target}")
                skip_to_phase = target
                continue
            else:
                log(f"  -> Field '{field}' has value, continuing")
                continue

        description = step.get("description", action)
        optional = step.get("optional", False)
        step_num = i + 1

        log(f"[Step {step_num}/{len(steps)}] {description}")

        # ── Sprint 4c: interruption detection ─────────────────
        # If step declares expected_activity, verify phone is there. If not,
        # pause + ask UI. Skip check for system/prep actions without expectation.
        ok, current = check_expected_activity(device_id, step)
        if not ok:
            expected = step.get("expected_activity", "")
            log(f"  -> [INTERRUPTION] expected '{expected}', current '{current}'")
            log(f"  -> [INTERRUPTION] waiting for user (Resume/Skip/Abort) via signal file…")
            action_signal = wait_for_user_signal(timeout=120)
            if action_signal == 'abort':
                log("  -> [INTERRUPTION] user aborted — stopping flow")
                step["_force_stop"] = True
                failed_steps += 1
                break
            elif action_signal == 'skip':
                log("  -> [INTERRUPTION] user skipped this step")
                continue
            elif action_signal == 'timeout':
                log("  -> [INTERRUPTION] timed out waiting — treating as abort")
                step["_force_stop"] = True
                failed_steps += 1
                break
            # 'resume' → fall through and execute step (user fixed state)
            log("  -> [INTERRUPTION] user resumed — re-verifying…")
            ok2, current2 = check_expected_activity(device_id, step)
            if not ok2:
                log(f"  -> [INTERRUPTION] still mismatched (current: {current2}), continuing anyway")

        handler = ACTION_MAP.get(action)
        if not handler:
            log(f"  -> Unknown action: {action}, skipping")
            continue

        # Retry logic: retry the action if it fails or wait_for doesn't match
        # Default 3 retries for steps with wait_for, 1 for others
        wait_for = step.get("wait_for", "")
        default_retries = 1
        max_retries = step.get("retry", default_retries)
        wait_timeout = step.get("wait_timeout", 20)
        retry_delay = step.get("retry_delay", 3)

        for attempt in range(max_retries):
            if attempt > 0:
                # Before retry, check if Shopee is showing network error
                recovered = check_and_recover_network_error(device_id)
                if recovered:
                    log(f"  -> Retry {attempt + 1}/{max_retries} (after network recovery)...")
                else:
                    log(f"  -> Retry {attempt + 1}/{max_retries} (waiting {retry_delay}s)...")
                    time.sleep(retry_delay)

            try:
                success = handler(device_id, step, flow_path)
            except Exception as e:
                log(f"  -> Exception: {e}")
                success = False

            if not success:
                if attempt < max_retries - 1:
                    log(f"  -> Step failed, will retry...")
                    continue
                elif optional:
                    log(f"  -> Optional step skipped after {max_retries} attempts")
                    break
                else:
                    failed_steps += 1
                    log(f"  -> FATAL: Step failed after {max_retries} attempts")
                    step["_force_stop"] = True
                    break

            # If wait_for is specified, verify we reached the expected screen
            if wait_for:
                delay = step.get("delay_after", 0.5)
                if delay > 0:
                    time.sleep(delay)
                if wait_for_activity(device_id, wait_for, timeout=wait_timeout, interval=2):
                    log(f"  -> Step {step_num} complete (screen verified)")
                    break
                else:
                    log(f"  -> Expected screen '{wait_for}' not reached")
                    # Fallback: if step has fallback_tap_pct, try coord tap and re-wait
                    # (handles case where u2 click fired but Shopee ignored it — happens
                    # on some elements that require real touch events)
                    fb = step.get("fallback_tap_pct")
                    if fb and fb.get("x_pct") is not None and not step.get("_fallback_tried"):
                        step["_fallback_tried"] = True
                        log(f"  -> trying fallback_tap_pct ({fb['x_pct']}, {fb['y_pct']})")
                        try:
                            action_tap_pct(device_id, fb, flow_path)
                        except Exception as e:
                            log(f"  -> fallback tap error: {e}")
                        if wait_for_activity(device_id, wait_for, timeout=wait_timeout, interval=2):
                            log(f"  -> Step {step_num} complete (via fallback coord)")
                            break
                    check_and_recover_network_error(device_id)
                    if attempt < max_retries - 1:
                        continue  # retry
                    else:
                        log(f"  -> All {max_retries} retries exhausted for '{wait_for}'")
                        if not optional:
                            failed_steps += 1
                            log(f"  -> FATAL: Screen verification failed, stopping this item")
                            step["_force_stop"] = True
                        break
            else:
                log(f"  -> Step {step_num} complete")
                break

        if (step.get("stop_on_fail", False) or step.get("_force_stop", False)) and failed_steps > 0:
            log(f"  -> Stopping flow for this item due to failure")
            break

        # Only apply delay_after if wait_for didn't already wait
        if not wait_for:
            delay = step.get("delay_after", 0.5)
            if delay > 0:
                time.sleep(delay)
            # After significant delays, check for network error screen
            if delay >= 3 and failed_steps == 0:
                if check_and_recover_network_error(device_id):
                    log(f"  -> Network error detected after step, waiting for recovery...")
                    time.sleep(5)
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
        delay_min = variables.get("delay_min", variables.get("delay_between_items", 5))
        delay_max = variables.get("delay_max", delay_min)
        distribution = variables.get("delay_distribution", "uniform")

        log(f"Delay: {delay_min}-{delay_max}s ({distribution})")
        log("")

        for idx, item in enumerate(items):
            item_num = idx + 1
            log(f"╔══════════════════════════════════════════════╗")
            log(f"║  ITEM {item_num}/{total}")

            # Show item details
            for k, v in item.items():
                if k.startswith("_") or k.startswith("delay"):
                    continue
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
                import random
                if distribution == "gaussian":
                    mean = (delay_min + delay_max) / 2
                    std = (delay_max - delay_min) / 4
                    delay = max(delay_min, min(delay_max, random.gauss(mean, std)))
                else:
                    delay = random.uniform(delay_min, delay_max)
                delay = round(delay, 1)
                log(f"")
                log(f"--- Waiting {delay}s before next item ---")
                time.sleep(delay)
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
    parser.add_argument("--adb_path", default="adb", help="Path to ADB binary")
    parser.add_argument("--signal_file", default=None, help="Path for engine↔UI signal file (for pause/resume control)")
    args = parser.parse_args()

    global ADB_PATH, SIGNAL_FILE
    ADB_PATH = args.adb_path
    SIGNAL_FILE = args.signal_file
    if SIGNAL_FILE:
        # Clean any stale signal at startup
        try:
            if os.path.exists(SIGNAL_FILE): os.remove(SIGNAL_FILE)
        except Exception:
            pass

    try:
        variables = json.loads(args.vars)
    except json.JSONDecodeError:
        log(f"WARNING: Invalid --vars JSON, using empty vars")
        variables = {}

    execute_flow(args.device, args.flow_path, variables)


if __name__ == "__main__":
    main()

