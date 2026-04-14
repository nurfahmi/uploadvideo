#!/bin/bash
# ── AutoFlow macOS Bundle Script ──────────────────────
# Run this on macOS BEFORE `npm run tauri build`
# Downloads Python standalone + ADB, installs pip packages,
# places everything in src-tauri/resources/
#
# Usage: bash scripts/bundle-macos.sh

set -e

PYTHON_VERSION="3.11.9"
ARCH=$(uname -m)  # arm64 or x86_64

if [ "$ARCH" = "arm64" ]; then
    PYTHON_URL="https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-macos11.pkg"
else
    PYTHON_URL="https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-macos11.pkg"
fi

ADB_URL="https://dl.google.com/android/repository/platform-tools-latest-darwin.zip"
GET_PIP_URL="https://bootstrap.pypa.io/get-pip.py"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
RESOURCES="$ROOT/app/src-tauri/resources"
TEMP_DIR="$ROOT/app/src-tauri/_build_temp"

echo "=== AutoFlow macOS Bundle Script ==="
echo "Resources dir: $RESOURCES"
echo "Architecture: $ARCH"

# Create temp dir
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

# ── 1. Python (use system or venv) ────────────────────

echo ""
echo "[1/3] Setting up Python..."

PYTHON_DIR="$RESOURCES/python"
rm -rf "$PYTHON_DIR"
mkdir -p "$PYTHON_DIR/bin" "$PYTHON_DIR/lib"

# For macOS, we use a standalone Python build from python-build-standalone
# or simply copy the venv
if [ -d "$ROOT/.venv" ]; then
    echo "  Using existing venv..."
    cp -r "$ROOT/.venv/"* "$PYTHON_DIR/"
else
    echo "  Creating fresh venv..."
    python3 -m venv "$PYTHON_DIR"
    "$PYTHON_DIR/bin/pip" install -r "$RESOURCES/engine/requirements.txt"
fi

echo "  Python ready"

# ── 2. ADB Platform Tools ────────────────────────────

echo ""
echo "[2/3] Downloading ADB Platform Tools..."

ADB_DIR="$RESOURCES/adb"
rm -rf "$ADB_DIR"
mkdir -p "$ADB_DIR"

curl -L -o "$TEMP_DIR/platform-tools.zip" "$ADB_URL"
unzip -q "$TEMP_DIR/platform-tools.zip" -d "$TEMP_DIR"
cp "$TEMP_DIR/platform-tools/adb" "$ADB_DIR/"
chmod +x "$ADB_DIR/adb"

echo "  ADB extracted to $ADB_DIR"

# ── 3. Verify engine + flows ─────────────────────────

echo ""
echo "[3/3] Verifying engine + flows..."

if [ ! -f "$RESOURCES/engine/engine.py" ]; then
    echo "  ERROR: engine.py not found in resources/engine/"
    echo "  Run: cp engine/engine.py app/src-tauri/resources/engine/"
    exit 1
fi

FLOW_COUNT=$(ls -d "$RESOURCES/flows/"*/ 2>/dev/null | wc -l | tr -d ' ')
echo "  engine.py: OK"
echo "  flows: $FLOW_COUNT template(s)"

# ── Cleanup ───────────────────────────────────────────

rm -rf "$TEMP_DIR"

echo ""
echo "=== Bundle complete! ==="
echo ""
echo "Resource sizes:"
for dir in "$RESOURCES"/*/; do
    name=$(basename "$dir")
    size=$(du -sh "$dir" | cut -f1)
    printf "  %-12s %s\n" "$name" "$size"
done
total=$(du -sh "$RESOURCES" | cut -f1)
printf "  %-12s %s\n" "TOTAL" "$total"

echo ""
echo "Next step: cd app && npm run tauri build"
