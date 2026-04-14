# ── AutoFlow Windows Bundle Script ─────────────────────
# Run this on Windows BEFORE `npm run tauri build`
# Downloads Python Embeddable + ADB, installs pip packages,
# places everything in src-tauri/resources/
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\bundle-windows.ps1

$ErrorActionPreference = "Stop"

$PYTHON_VERSION = "3.11.9"
$PYTHON_URL = "https://www.python.org/ftp/python/$PYTHON_VERSION/python-$PYTHON_VERSION-embed-amd64.zip"
$ADB_URL = "https://dl.google.com/android/repository/platform-tools-latest-windows.zip"
$GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py"

$ROOT = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path "$ROOT\autoflow-workspace")) { $ROOT = Split-Path -Parent $PSScriptRoot }
$RESOURCES = "$ROOT\autoflow-workspace\app\src-tauri\resources"
$TEMP_DIR = "$ROOT\autoflow-workspace\app\src-tauri\_build_temp"

Write-Host "=== AutoFlow Windows Bundle Script ===" -ForegroundColor Cyan
Write-Host "Resources dir: $RESOURCES"

# Create temp dir
if (Test-Path $TEMP_DIR) { Remove-Item -Recurse -Force $TEMP_DIR }
New-Item -ItemType Directory -Force -Path $TEMP_DIR | Out-Null

# ── 1. Python Embeddable ──────────────────────────────

Write-Host ""
Write-Host "[1/4] Downloading Python $PYTHON_VERSION Embeddable..." -ForegroundColor Yellow

$pythonZip = "$TEMP_DIR\python-embed.zip"
$pythonDir = "$RESOURCES\python"

if (Test-Path $pythonDir) { Remove-Item -Recurse -Force $pythonDir }
New-Item -ItemType Directory -Force -Path $pythonDir | Out-Null

Invoke-WebRequest -Uri $PYTHON_URL -OutFile $pythonZip
Expand-Archive -Path $pythonZip -DestinationPath $pythonDir -Force

Write-Host "  Python extracted to $pythonDir" -ForegroundColor Green

# ── 2. Enable pip in Embeddable Python ────────────────

Write-Host ""
Write-Host "[2/4] Installing pip into embedded Python..." -ForegroundColor Yellow

# Uncomment 'import site' in python311._pth to enable pip/site-packages
$pthFile = Get-ChildItem "$pythonDir\python*._pth" | Select-Object -First 1
if ($pthFile) {
    $content = Get-Content $pthFile.FullName
    $content = $content -replace "^#import site", "import site"
    # Also add Lib\site-packages path
    $content += "`nLib\site-packages"
    Set-Content $pthFile.FullName $content
    Write-Host "  Updated $($pthFile.Name) to enable site-packages" -ForegroundColor Green
}

# Download and run get-pip.py
$getPip = "$TEMP_DIR\get-pip.py"
Invoke-WebRequest -Uri $GET_PIP_URL -OutFile $getPip
& "$pythonDir\python.exe" $getPip --no-warn-script-location
Write-Host "  pip installed" -ForegroundColor Green

# ── 3. Install Python packages ────────────────────────

Write-Host ""
Write-Host "[3/4] Installing airtest + pure-python-adb..." -ForegroundColor Yellow

$requirementsFile = "$RESOURCES\engine\requirements.txt"
if (Test-Path $requirementsFile) {
    & "$pythonDir\python.exe" -m pip install --no-warn-script-location -r $requirementsFile --target "$pythonDir\Lib\site-packages"
} else {
    & "$pythonDir\python.exe" -m pip install --no-warn-script-location airtest pure-python-adb --target "$pythonDir\Lib\site-packages"
}
Write-Host "  Packages installed" -ForegroundColor Green

# ── 4. ADB Platform Tools ────────────────────────────

Write-Host ""
Write-Host "[4/4] Downloading ADB Platform Tools..." -ForegroundColor Yellow

$adbZip = "$TEMP_DIR\platform-tools.zip"
$adbDir = "$RESOURCES\adb"

if (Test-Path $adbDir) { Remove-Item -Recurse -Force $adbDir }
New-Item -ItemType Directory -Force -Path $adbDir | Out-Null

Invoke-WebRequest -Uri $ADB_URL -OutFile $adbZip
Expand-Archive -Path $adbZip -DestinationPath $TEMP_DIR -Force

# Move only the needed files (adb.exe + DLLs)
Copy-Item "$TEMP_DIR\platform-tools\adb.exe" "$adbDir\"
Copy-Item "$TEMP_DIR\platform-tools\AdbWinApi.dll" "$adbDir\"
Copy-Item "$TEMP_DIR\platform-tools\AdbWinUsbApi.dll" "$adbDir\"

Write-Host "  ADB extracted to $adbDir" -ForegroundColor Green

# ── Cleanup ───────────────────────────────────────────

Remove-Item -Recurse -Force $TEMP_DIR
Write-Host ""
Write-Host "=== Bundle complete! ===" -ForegroundColor Cyan

# Show sizes
Write-Host ""
Write-Host "Resource sizes:" -ForegroundColor Yellow
Get-ChildItem $RESOURCES -Directory | ForEach-Object {
    $size = (Get-ChildItem $_.FullName -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host ("  {0,-12} {1:N1} MB" -f $_.Name, $size)
}
$total = (Get-ChildItem $RESOURCES -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ("  {0,-12} {1:N1} MB" -f "TOTAL", $total) -ForegroundColor Cyan

Write-Host ""
Write-Host "Next step: cd autoflow-workspace\app && npm run tauri build" -ForegroundColor Green
