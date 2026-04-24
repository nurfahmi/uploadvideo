# AUV Icon Pack

Icon pack lengkap untuk AUV (AutoFlow Uploader Video).
Generated dari source 1254x1254 PNG.

## Structure

```
auv-icon-pack/
├── master-1024.png          # Master file buat re-generate kalo perlu
├── master-1254.png          # Original source
├── manifest.json            # PWA manifest
├── html-snippet.html        # HTML meta tags buat website
│
├── ios/                     # iOS App Store (15 sizes)
├── android/                 # Android + Play Store (6 sizes)
├── macos/                   # macOS .icns components (10 sizes)
├── windows/                 # Windows .ico + PNGs
├── web/                     # Favicons + Apple touch + MS tile
├── tauri/                   # Tauri desktop app
├── pwa/                     # Progressive Web App
└── social/                  # Social media profiles
```

## Usage per Platform

### Tauri (Desktop App buat AUV)
Copy semua file dari `tauri/` ke project lu di folder `src-tauri/icons/`.
Update `tauri.conf.json`:
```json
"bundle": {
  "icon": [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.icns",
    "icons/icon.ico"
  ]
}
```

Note: `.icns` buat macOS belum di-generate di sini, lu bisa bikin pake:
```bash
# macOS only
iconutil -c icns macos/AppIcon.iconset
```

### Web / Next.js / Laravel
1. Copy folder `web/` ke `public/` di project lu
2. Copy `manifest.json` ke `public/`
3. Paste isi `html-snippet.html` ke `<head>` di layout utama

### iOS (Xcode)
Drag & drop semua file dari `ios/` ke Assets.xcassets → AppIcon

### Android (Android Studio)
Copy folder `android/mipmap-*` ke `app/src/main/res/`
Replace `ic_launcher.png` existing.

### Playstore
Upload `android/playstore-icon.png` (512x512) pas submit app.

### App Store
Upload `ios/Icon-1024.png` pas submit ke App Store Connect.

---

Generated on 24 April 2026 buat AUV (AutoFlow Uploader Video).
