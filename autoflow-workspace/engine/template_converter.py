#!/usr/bin/env python3
"""
Template → Flow Converter.
Converts recorder template JSON into a hybrid flow.json
that works across different phone resolutions.

Usage:
    python template_converter.py <template.json> <output_flow_dir> [target_w] [target_h]
"""
import sys
import json
import os


def convert_template(template, target_w=0, target_h=0):
    """Convert a recorder template into a hybrid flow.json structure."""
    steps = template.get("steps", [])
    platform = template.get("platform", "shopee")
    name = template.get("name", "Recorded Flow")
    screen = template.get("screen_size", {})
    record_device = template.get("record_device", {})

    # Build device_profile from recorder data
    rec_w = screen.get("w", screen.get("width", 0))
    rec_h = screen.get("h", screen.get("height", 0))
    device_profile = {
        "resolution": f"{rec_w}x{rec_h}" if rec_w and rec_h else "1080x2400",
    }
    if record_device:
        model = f"{record_device.get('brand', '')} {record_device.get('model', '')}".strip()
        if model:
            device_profile["model"] = model
        if record_device.get("android_version"):
            device_profile["android"] = record_device["android_version"]

    # Determine batch fields based on platform
    if platform == "shopee":
        batch_fields = [
            {"key": "video_path", "label": "Video File", "required": True},
            {"key": "caption", "label": "Caption", "placeholder": "Deskripsi produk..."},
            {"key": "hashtags", "label": "Hashtags", "placeholder": "#shopee #promo"},
            {"key": "affiliate_link", "label": "Affiliate Link",
             "placeholder": "https://shopee.co.id/...", "required": False},
        ]
    elif platform == "tiktok":
        batch_fields = [
            {"key": "video_path", "label": "Video File", "required": True},
            {"key": "caption", "label": "Caption", "placeholder": "Write caption..."},
            {"key": "hashtags", "label": "Hashtags", "placeholder": "#fyp #viral"},
            {"key": "product_url", "label": "Product URL",
             "placeholder": "https://shop.tiktok.com/...", "required": False},
        ]
    else:
        batch_fields = [
            {"key": "video_path", "label": "Video File", "required": True},
            {"key": "caption", "label": "Caption"},
        ]

    flow_steps = []
    for i, step in enumerate(steps):
        action = step.get("action", "tap")
        converted = convert_step(step, i, rec_w, rec_h)
        if converted:
            flow_steps.append(converted)

    flow = {
        "name": name,
        "platform": platform,
        "batch": True,
        "device_profile": device_profile,
        "batch_fields": batch_fields,
        "steps": flow_steps,
    }
    return flow


def convert_step(step, index, rec_w, rec_h):
    """Convert a single recorder step to a hybrid flow step."""
    action = step.get("action", "tap")

    if action == "tap":
        return convert_tap(step, index, rec_w, rec_h)
    elif action == "type":
        return convert_type(step, index)
    elif action == "wait":
        duration = step.get("duration", step.get("custom_delay_seconds", 2))
        return {
            "action": "wait",
            "duration": duration,
            "description": f"Step {index + 1}: wait {duration}s",
        }
    elif action == "screenshot":
        return {
            "action": "screenshot",
            "output": step.get("output", f"_shot_{index}.png"),
            "description": f"Step {index + 1}: screenshot",
            "optional": True,
        }
    else:
        # Pass through unknown actions
        return step


def convert_tap(step, index, rec_w, rec_h):
    """Convert a tap step to hybrid: u2_click with fallback_tap_pct, or tap_pct."""
    element = step.get("element", {})
    coord = step.get("coord", {})
    coord_pct = step.get("coord_pct", {})

    # Calculate percentage from raw coords if coord_pct not available
    if not coord_pct and coord and rec_w and rec_h:
        coord_pct = {
            "x_pct": round(coord.get("x", 0) / rec_w, 4),
            "y_pct": round(coord.get("y", 0) / rec_h, 4),
        }

    # Determine delay from timing or custom override
    delay = step.get("custom_delay_seconds")
    if delay is None:
        delay = 2  # default

    # Build the best action based on available element info
    has_resource_id = bool(element.get("resourceId"))
    has_text = bool(element.get("text"))
    has_content_desc = bool(element.get("contentDescription"))
    has_selector = has_resource_id or has_text or has_content_desc

    if has_selector:
        # Use u2_click with fallback_tap_pct
        result = {
            "action": "u2_click",
            "description": f"Step {index + 1}: tap",
        }
        if has_resource_id:
            result["resourceId"] = element["resourceId"]
        if has_text:
            # Only use text if it's short and meaningful
            text = element["text"]
            if len(text) <= 40:
                result["text"] = text
        if has_content_desc:
            result["contentDescription"] = element["contentDescription"]

        if coord_pct:
            result["fallback_tap_pct"] = coord_pct

        # Activity verification
        if step.get("activity_changed") and step.get("activity_after"):
            act = step["activity_after"].split("/")[-1] if "/" in step["activity_after"] else step["activity_after"]
            result["wait_for"] = act
            result["wait_timeout"] = 20
            result["retry"] = 2

        result["delay_after"] = delay
        return result
    else:
        # No selector: use tap_pct (percentage-based)
        if coord_pct:
            result = {
                "action": "tap_pct",
                "x_pct": coord_pct.get("x_pct", 0.5),
                "y_pct": coord_pct.get("y_pct", 0.5),
                "description": f"Step {index + 1}: tap (coord)",
            }
            if step.get("activity_changed") and step.get("activity_after"):
                act = step["activity_after"].split("/")[-1] if "/" in step["activity_after"] else step["activity_after"]
                result["wait_for"] = act
                result["wait_timeout"] = 20
                result["retry"] = 2
            result["delay_after"] = delay
            return result
        else:
            # No coord info at all — skip
            return None


def convert_type(step, index):
    """Convert a type step to u2_type."""
    element = step.get("element", {})
    text = step.get("text", "")
    clear = not step.get("append", False)

    result = {
        "action": "u2_type",
        "text": text,
        "clear": clear,
        "description": f"Step {index + 1}: type",
    }

    if element.get("resourceId"):
        result["resourceId"] = element["resourceId"]
    if element.get("className"):
        result["className"] = element["className"]

    delay = step.get("custom_delay_seconds", 5)
    result["delay_after"] = delay
    return result


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: template_converter.py <template.json> <output_dir> [target_w] [target_h]"}))
        sys.exit(1)

    template_path = sys.argv[1]
    output_dir = sys.argv[2]
    target_w = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    target_h = int(sys.argv[4]) if len(sys.argv) > 4 else 0

    with open(template_path, "r") as f:
        template = json.load(f)

    flow = convert_template(template, target_w, target_h)

    # Write flow.json to output directory
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "flow.json")
    with open(output_path, "w") as f:
        json.dump(flow, f, indent=2, ensure_ascii=False)

    print(json.dumps({
        "ok": True,
        "steps": len(flow["steps"]),
        "output": output_path,
    }))


if __name__ == "__main__":
    main()
