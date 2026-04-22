#!/usr/bin/env python3
"""Recorder helper: dumps UI hierarchy, finds element at (x, y),
taps device, returns step data as JSON.

Usage:
    python recorder_helper.py tap <device_id> <x> <y> <adb_path>
    python recorder_helper.py text <device_id> <element_selector_json>
"""
import sys
import json
import subprocess
import xml.etree.ElementTree as ET


def adb(adb_path, device_id, *args, timeout=10):
    cmd = [adb_path, "-s", device_id, *args]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return r.stdout.strip()


def dump_hierarchy(adb_path, device_id, retries=2):
    """Dump UI hierarchy via uiautomator2. Retry on transient atx-agent hiccups."""
    import uiautomator2 as u2
    last_err = None
    for attempt in range(retries + 1):
        try:
            d = u2.connect(device_id)
            return d.dump_hierarchy()
        except Exception as e:
            last_err = e
            import time
            time.sleep(0.5)
    raise last_err if last_err else RuntimeError("dump_hierarchy failed")


def _node_to_dict(node, bounds):
    a = node.attrib
    return {
        "resourceId": a.get("resource-id") or "",
        "text": (a.get("text") or "").strip(),
        "contentDescription": (a.get("content-desc") or "").strip(),
        "className": a.get("class") or "",
        "clickable": a.get("clickable") == "true",
        "bounds": bounds,
    }


def find_element_at(xml_str, x, y):
    """Find smallest bounding node that contains (x, y) with a useful selector.
    Prefers EditText over non-text containers (so tapping near caption field
    edge still picks the EditText, not the wrapping RelativeLayout)."""
    try:
        root = ET.fromstring(xml_str)
    except ET.ParseError:
        return None

    candidates = []
    for node in root.iter("node"):
        bounds = node.attrib.get("bounds", "")
        if not bounds.startswith("["):
            continue
        try:
            parts = bounds.replace("][", ",").strip("[]").split(",")
            x1, y1, x2, y2 = map(int, parts)
        except (ValueError, TypeError):
            continue
        if x1 <= x <= x2 and y1 <= y <= y2:
            area = (x2 - x1) * (y2 - y1)
            candidates.append((area, node, (x1, y1, x2, y2)))

    if not candidates:
        return None

    # Prefer EditText (or any *TextField-like input) if one is among candidates
    text_inputs = [c for c in candidates
                   if any(k in (c[1].attrib.get("class") or "") for k in ("EditText", "TextField"))]
    if text_inputs:
        # pick the smallest EditText (deepest / most specific)
        text_inputs.sort(key=lambda c: c[0])
        return _node_to_dict(text_inputs[0][1], text_inputs[0][2])

    candidates.sort(key=lambda c: c[0])
    for _, node, bounds in candidates:
        a = node.attrib
        if a.get("resource-id") or a.get("text") or a.get("content-desc") or a.get("clickable") == "true":
            return _node_to_dict(node, bounds)
    _, node, bounds = candidates[0]
    return _node_to_dict(node, bounds)


def cmd_tap(argv):
    device_id = argv[0]
    x = int(argv[1])
    y = int(argv[2])
    adb_path = argv[3]

    # 1. Dump hierarchy BEFORE tap
    xml_before = dump_hierarchy(adb_path, device_id)

    # 2. Find element at coord
    element = find_element_at(xml_before, x, y)

    # 3. Get screen size (for percentage calc)
    wm = adb(adb_path, device_id, "shell", "wm", "size")
    sw, sh = 1080, 2400  # fallback
    if ":" in wm:
        try:
            parts = wm.split(":")[-1].strip().split("x")
            sw, sh = int(parts[0]), int(parts[1])
        except Exception:
            pass

    # 4. Get current activity (for wait_for in run)
    before_activity = ""
    act_out = adb(adb_path, device_id, "shell", "dumpsys", "activity", "activities")
    for line in act_out.splitlines():
        if "mFocusedApp" in line or "topResumedActivity" in line:
            for part in line.strip().split():
                if "/" in part and "." in part:
                    before_activity = part.split("}")[0].strip()
                    break
            if before_activity:
                break

    # 5. Execute tap
    adb(adb_path, device_id, "shell", "input", "tap", str(x), str(y))

    # 6. Wait briefly, get activity AFTER (caller can compare for wait_for generation)
    import time
    time.sleep(0.8)
    after_activity = ""
    act_out2 = adb(adb_path, device_id, "shell", "dumpsys", "activity", "activities")
    for line in act_out2.splitlines():
        if "mFocusedApp" in line or "topResumedActivity" in line:
            for part in line.strip().split():
                if "/" in part and "." in part:
                    after_activity = part.split("}")[0].strip()
                    break
            if after_activity:
                break

    result = {
        "element": element,
        "coord": {"x": x, "y": y},
        "coord_pct": {
            "x_pct": round(x / sw, 4),
            "y_pct": round(y / sh, 4),
        },
        "screen_size": {"width": sw, "height": sh},
        "activity_before": before_activity,
        "activity_after": after_activity,
        "activity_changed": before_activity != after_activity,
    }
    print(json.dumps(result))


def cmd_type(argv):
    """Type text into a UI element via uiautomator2 set_text.
    Reads {selector, text, clear} JSON from stdin.
    Element focus is not required — set_text uses accessibility API."""
    device_id = argv[0]
    adb_path = argv[1]
    try:
        import uiautomator2 as u2
    except ImportError:
        print(json.dumps({"error": "uiautomator2 not installed"}))
        sys.exit(1)

    payload = json.loads(sys.stdin.read())
    selector = payload.get("selector", {})
    text = payload.get("text", "")
    clear = payload.get("clear", True)

    # Build u2 kwargs (priority: resourceId > text > description > className)
    u2_sel = {}
    if selector.get("resourceId"):
        u2_sel["resourceId"] = selector["resourceId"]
    elif selector.get("text"):
        u2_sel["text"] = selector["text"]
    elif selector.get("contentDescription"):
        u2_sel["description"] = selector["contentDescription"]
    elif selector.get("className"):
        u2_sel["className"] = selector["className"]
    else:
        print(json.dumps({"error": "selector must have at least one of: resourceId, text, contentDescription, className"}))
        sys.exit(1)

    d = u2.connect(device_id)
    el = d(**u2_sel)
    if not el.exists(timeout=4):
        print(json.dumps({"error": f"element not found: {u2_sel}"}))
        sys.exit(1)

    # If the matched element isn't actually a text input, try to find an
    # EditText descendant. Otherwise set_text is a silent no-op on containers.
    try:
        info = el.info
        cls = info.get("className") or ""
    except Exception:
        cls = ""
    if not any(k in cls for k in ("EditText", "TextField")):
        # Try to find a descendant EditText (bounds inside the matched element)
        try:
            child = d(**u2_sel).child(className="android.widget.EditText")
            if child.exists(timeout=2):
                el = child
                info = el.info
                cls = info.get("className") or ""
        except Exception:
            pass
    if not any(k in cls for k in ("EditText", "TextField")):
        # Still not a text input — set_text would silently fail. Fail loud instead.
        print(json.dumps({"error": f"target is {cls!r}, not a text input. Selector: {u2_sel}"}))
        sys.exit(1)

    try:
        if clear:
            el.clear_text()
            el.set_text(text)
            final = text
        else:
            # Append: read existing, concatenate, set
            existing = el.get_text() or ""
            # Accessibility reports hint as text when field is empty; guard against that
            try:
                hint = el.info.get("hint") or ""
            except Exception:
                hint = ""
            if existing == hint:
                existing = ""
            combined = existing + text
            el.set_text(combined)
            final = combined
    except Exception as e:
        print(json.dumps({"error": f"set_text failed: {e}"}))
        sys.exit(1)

    print(json.dumps({"success": True, "chars_typed": len(final), "appended": not clear, "selector_used": u2_sel, "class": cls}))


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: recorder_helper.py <command> ..."}))
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "tap":
        cmd_tap(sys.argv[2:])
    elif cmd == "type":
        cmd_type(sys.argv[2:])
    else:
        print(json.dumps({"error": f"unknown command: {cmd}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
