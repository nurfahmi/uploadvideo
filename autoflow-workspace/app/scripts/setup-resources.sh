#!/bin/bash
# ── AutoFlow Resource Setup (macOS / Linux) ──────────────
# Downloads and bundles Python + ADB for production builds.
# Run this BEFORE `cargo tauri build`.
#
# Usage: ./scripts/setup-resources.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$APP_DIR")"
RESOURCES="$APP_DIR/resources"

echo "=== AutoFlow Resource Setup ==="
echo "Resources dir: $RESOURCES"

mkdir -p "$RESOURCES/python" "$RESOURCES/adb" "$RESOURCES/engine" "$RESOURCES/flows"

# ── Detect platform ──────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"

if [ "$OS" = "Darwin" ]; then
    PLATFORM="darwin"
    ADB_PLATFORM="darwin"
elif [ "$OS" = "Linux" ]; then
    PLATFORM="linux"
    ADB_PLATFORM="linux"
else
    echo "ERROR: Unsupported OS: $OS (use setup-resources.ps1 for Windows)"
    exit 1
fi

echo "Platform: $OS $ARCH"

# ── Python (indygreg/python-build-standalone) ────────────
PYTHON_VERSION="3.11.9"
PYTHON_RELEASE="20240415"

if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
    PYTHON_TRIPLE="aarch64-apple-darwin"
    [ "$PLATFORM" = "linux" ] && PYTHON_TRIPLE="aarch64-unknown-linux-gnu"
else
    PYTHON_TRIPLE="x86_64-apple-darwin"
    [ "$PLATFORM" = "linux" ] && PYTHON_TRIPLE="x86_64-unknown-linux-gnu"
fi

PYTHON_URL="https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_RELEASE}/cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}-${PYTHON_TRIPLE}-install_only.tar.gz"

if [ -f "$RESOURCES/python/bin/python3" ] || [ -f "$RESOURCES/python/bin/python3.11" ]; then
    echo "[Python] Already exists, skipping download"
else
    echo "[Python] Downloading Python ${PYTHON_VERSION} for ${PYTHON_TRIPLE}..."
    curl -L "$PYTHON_URL" -o /tmp/autoflow-python.tar.gz
    echo "[Python] Extracting..."
    tar xzf /tmp/autoflow-python.tar.gz -C "$RESOURCES/python/" --strip-components=1
    rm /tmp/autoflow-python.tar.gz
    echo "[Python] Installed at $RESOURCES/python/"
fi

# ── Python packages (airtest, pure-python-adb) ──────────
PYTHON_BIN="$RESOURCES/python/bin/python3"
if [ ! -f "$PYTHON_BIN" ]; then
    PYTHON_BIN="$RESOURCES/python/bin/python3.11"
fi

if "$PYTHON_BIN" -c "import airtest" 2>/dev/null; then
    echo "[Pip] Packages already installed, skipping"
else
    echo "[Pip] Installing airtest + pure-python-adb..."
    "$PYTHON_BIN" -m pip install --upgrade pip --quiet
    "$PYTHON_BIN" -m pip install airtest pure-python-adb --quiet
    echo "[Pip] Packages installed"
fi

# ── ADB (Android platform-tools) ────────────────────────
if [ -f "$RESOURCES/adb/adb" ]; then
    echo "[ADB] Already exists, skipping download"
else
    echo "[ADB] Downloading platform-tools for $ADB_PLATFORM..."
    curl -L "https://dl.google.com/android/repository/platform-tools-latest-${ADB_PLATFORM}.zip" -o /tmp/autoflow-platform-tools.zip
    echo "[ADB] Extracting adb binary..."
    unzip -o /tmp/autoflow-platform-tools.zip -d /tmp/autoflow-pt/
    cp /tmp/autoflow-pt/platform-tools/adb "$RESOURCES/adb/adb"
    chmod +x "$RESOURCES/adb/adb"
    rm -rf /tmp/autoflow-pt /tmp/autoflow-platform-tools.zip
    echo "[ADB] Installed at $RESOURCES/adb/"
fi

# ── Engine ───────────────────────────────────────────────
echo "[Engine] Copying engine.py..."
cp "$PROJECT_DIR/engine/engine.py" "$RESOURCES/engine/engine.py"

# ── Flow templates ───────────────────────────────────────
echo "[Flows] Copying flow templates..."
cp -R "$PROJECT_DIR/flows/"* "$RESOURCES/flows/" 2>/dev/null || true

# ── Summary ──────────────────────────────────────────────
echo ""
echo "=== Setup Complete ==="
echo "Python:  $RESOURCES/python/"
echo "ADB:     $RESOURCES/adb/"
echo "Engine:  $RESOURCES/engine/"
echo "Flows:   $RESOURCES/flows/"
echo ""
echo "Total size:"
du -sh "$RESOURCES"
echo ""
echo "Ready to build: cd $APP_DIR && npm run tauri build"
