#!/usr/bin/env python3
"""UI inspector: dumps the current screen's view hierarchy + screenshot + a
clickable-element summary. Run interactively — navigate the phone by hand
and press Enter at each screen you want captured.

Usage:
    python scripts/ui_dump.py <device_id> [--out ui_dumps]

Requires uiautomator2 (already in .venv). First run on a fresh device will
auto-install the u2 agent APK (takes ~30s).
"""
import argparse
import os
import sys
import time
import xml.etree.ElementTree as ET


def connect(device_id):
    try:
        import uiautomator2 as u2
    except ImportError:
        sys.exit("uiautomator2 not installed. Activate .venv or: pip install uiautomator2")
    print(f"Connecting to {device_id} …")
    d = u2.connect(device_id)
    info = d.info
    print(f"  model:    {info.get('productName')}")
    print(f"  display:  {info.get('displayWidth')}x{info.get('displayHeight')}")
    print(f"  sdk:      {info.get('sdkInt')}")
    return d


def dump_one(d, out_dir, label):
    ts = time.strftime("%H%M%S")
    base = f"{label}_{ts}"
    xml_path = os.path.join(out_dir, f"{base}.xml")
    png_path = os.path.join(out_dir, f"{base}.png")
    txt_path = os.path.join(out_dir, f"{base}.txt")

    xml = d.dump_hierarchy()
    with open(xml_path, "w", encoding="utf-8") as f:
        f.write(xml)
    d.screenshot(png_path)

    app = d.app_current()
    lines = [
        f"# UI dump: {label}",
        f"# package:  {app.get('package')}",
        f"# activity: {app.get('activity')}",
        "",
        "# Clickable / interactive elements (resourceId | text | class | bounds)",
        "",
    ]
    try:
        root = ET.fromstring(xml)
        for n in root.iter("node"):
            a = n.attrib
            interactive = (
                a.get("clickable") == "true"
                or a.get("long-clickable") == "true"
                or a.get("focusable") == "true"
                or a.get("class", "").endswith("EditText")
            )
            if not interactive:
                continue
            rid = a.get("resource-id") or "-"
            txt = (a.get("text") or "").strip() or "-"
            cls = a.get("class", "-").split(".")[-1]
            desc = (a.get("content-desc") or "").strip()
            bounds = a.get("bounds", "")
            extra = f" desc={desc!r}" if desc and desc != "-" else ""
            lines.append(f"{rid:50s}  {txt[:30]:30s}  {cls:20s}  {bounds}{extra}")
    except ET.ParseError as e:
        lines.append(f"(xml parse error: {e})")

    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"  → {txt_path}")
    print(f"  → {png_path}")
    print(f"  → {xml_path}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("device_id")
    p.add_argument("--out", default="ui_dumps")
    p.add_argument("--label", help="One-shot: dump once with this label and exit")
    args = p.parse_args()

    os.makedirs(args.out, exist_ok=True)
    d = connect(args.device_id)

    if args.label:
        dump_one(d, args.out, args.label)
        return

    print("\nInteractive mode. Navigate the phone to the screen you want to capture,")
    print("type a short label (e.g. 'home', 'post_form') and press Enter.")
    print("Type 'q' to quit.\n")
    while True:
        try:
            label = input("label> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not label:
            continue
        if label.lower() in {"q", "quit", "exit"}:
            break
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in label)
        dump_one(d, args.out, safe)


if __name__ == "__main__":
    main()
