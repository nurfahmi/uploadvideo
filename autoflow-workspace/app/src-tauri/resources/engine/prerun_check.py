#!/usr/bin/env python3
"""Pre-run health check. Validates device + item before engine starts.

Usage:
    python prerun_check.py <device_id> <adb_path> <item_json>

Emits JSON summary of check results.
"""
import json
import os
import subprocess
import sys
import urllib.request


def adb(adb_path, device_id, *args, timeout=10):
    try:
        r = subprocess.run([adb_path, "-s", device_id, *args],
                           capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception:
        return ""


def check_battery(adb_path, device_id):
    out = adb(adb_path, device_id, "shell", "dumpsys", "battery")
    level = None
    for line in out.splitlines():
        if "level:" in line:
            try:
                level = int(line.split(":")[-1].strip())
                break
            except ValueError:
                pass
    if level is None:
        return {"ok": True, "level": None, "msg": "Baterai tidak bisa dibaca (skip)."}
    if level < 20:
        return {"ok": False, "level": level, "severity": "warn",
                "msg": f"Baterai {level}% — isi daya dulu sebelum batch panjang."}
    return {"ok": True, "level": level}


def check_storage(adb_path, device_id, min_free_mb=100):
    out = adb(adb_path, device_id, "shell", "df", "/sdcard")
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[0].startswith("/"):
            try:
                # df output: Filesystem 1K-blocks Used Available
                avail_kb = int(parts[3])
                avail_mb = avail_kb // 1024
                if avail_mb < min_free_mb:
                    return {"ok": False, "free_mb": avail_mb, "severity": "error",
                            "msg": f"Storage HP tinggal {avail_mb}MB — hapus file dulu."}
                return {"ok": True, "free_mb": avail_mb}
            except Exception:
                break
    return {"ok": True, "msg": "Storage tidak bisa dibaca (skip)."}


def check_screen_on(adb_path, device_id):
    out = adb(adb_path, device_id, "shell", "dumpsys", "display")
    if "mScreenState=ON" in out or "mScreenState=OFF" not in out:
        return {"ok": True}
    return {"ok": False, "severity": "warn",
            "msg": "Layar HP mati — nyalakan dulu biar flow bisa jalan."}


def check_video_file(path):
    if not path:
        return {"ok": False, "severity": "error", "msg": "Video path kosong."}
    if not os.path.exists(path):
        return {"ok": False, "severity": "error",
                "msg": f"File video tidak ditemukan: {os.path.basename(path)}"}
    size = os.path.getsize(path)
    size_mb = size / (1024 * 1024)
    if size_mb > 100:
        return {"ok": False, "severity": "warn", "size_mb": round(size_mb, 1),
                "msg": f"Video {size_mb:.1f}MB — Shopee limit ~100MB, mungkin reject."}
    ext = os.path.splitext(path)[1].lower()
    if ext not in (".mp4", ".mov", ".m4v"):
        return {"ok": False, "severity": "error", "ext": ext,
                "msg": f"Format video {ext} mungkin tidak didukung Shopee (pakai .mp4)."}
    return {"ok": True, "size_mb": round(size_mb, 1)}


def check_url(url):
    if not url:
        return {"ok": True, "msg": "no URL provided (skip)"}
    if not url.startswith(("http://", "https://")):
        return {"ok": False, "severity": "error",
                "msg": "URL harus mulai dengan http:// atau https://"}
    try:
        req = urllib.request.Request(url, method="HEAD",
                                     headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as r:
            if r.status >= 400:
                return {"ok": False, "severity": "error", "status": r.status,
                        "msg": f"URL produk return {r.status} — link mungkin invalid."}
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "severity": "warn", "err": str(e),
                "msg": "URL tidak bisa di-cek (jaringan?). Lanjut dengan risiko."}


def check_text_limits(caption, hashtags):
    cap_len = len(caption or "")
    tag_count = len([t for t in (hashtags or "").split() if t.startswith("#")])
    msgs = []
    if cap_len > 150:
        msgs.append(f"Caption {cap_len} char — Shopee limit 150, akan dipotong.")
    if tag_count > 30:
        msgs.append(f"Hashtag {tag_count} — Shopee max ~30.")
    if msgs:
        return {"ok": False, "severity": "warn", "msg": " ".join(msgs),
                "caption_len": cap_len, "hashtag_count": tag_count}
    return {"ok": True, "caption_len": cap_len, "hashtag_count": tag_count}


def run_checks(device_id, adb_path, item):
    checks = {
        "battery": check_battery(adb_path, device_id),
        "storage": check_storage(adb_path, device_id),
        "screen": check_screen_on(adb_path, device_id),
        "video": check_video_file(item.get("video_path", "")),
        "url": check_url(item.get("affiliate_link", "")),
        "text_limits": check_text_limits(item.get("caption", ""), item.get("hashtags", "")),
    }
    has_error = any(
        v.get("ok") is False and v.get("severity") == "error"
        for v in checks.values()
    )
    has_warn = any(
        v.get("ok") is False and v.get("severity") == "warn"
        for v in checks.values()
    )
    return {
        "ok": not has_error,
        "has_warn": has_warn,
        "checks": checks,
    }


def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "usage: prerun_check.py <device_id> <adb_path> <item_json>"}))
        sys.exit(1)
    try:
        item = json.loads(sys.argv[3])
    except json.JSONDecodeError:
        print(json.dumps({"error": "item_json invalid"}))
        sys.exit(1)
    result = run_checks(sys.argv[1], sys.argv[2], item)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
