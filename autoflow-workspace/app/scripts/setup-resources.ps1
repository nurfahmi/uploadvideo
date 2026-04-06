# ── AutoFlow Resource Setup (Windows) ─────────────────────
# Downloads and bundles Python + ADB for production builds.
# Run this BEFORE `cargo tauri build`.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\setup-resources.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Split-Path -Parent $ScriptDir
$ProjectDir = Split-Path -Parent $AppDir
$Resources = Join-Path $AppDir "resources"

Write-Host "=== AutoFlow Resource Setup (Windows) ==="
Write-Host "Resources dir: $Resources"

New-Item -ItemType Directory -Force -Path "$Resources\python" | Out-Null
New-Item -ItemType Directory -Force -Path "$Resources\adb" | Out-Null
New-Item -ItemType Directory -Force -Path "$Resources\engine" | Out-Null
New-Item -ItemType Directory -Force -Path "$Resources\flows" | Out-Null

# ── Python Embeddable ─────────────────────────────────────
$PythonVersion = "3.11.9"
$PythonUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$PythonExe = Join-Path $Resources "python\python.exe"

if (Test-Path $PythonExe) {
    Write-Host "[Python] Already exists, skipping download"
} else {
    Write-Host "[Python] Downloading Python $PythonVersion embeddable..."
    $TmpZip = Join-Path $env:TEMP "autoflow-python.zip"
    Invoke-WebRequest -Uri $PythonUrl -OutFile $TmpZip
    Write-Host "[Python] Extracting..."
    Expand-Archive -Path $TmpZip -DestinationPath "$Resources\python" -Force
    Remove-Item $TmpZip

    # Enable pip: uncomment 'import site' in python311._pth
    $PthFile = Join-Path $Resources "python\python311._pth"
    if (Test-Path $PthFile) {
        $content = Get-Content $PthFile
        $content = $content -replace "^#import site", "import site"
        Set-Content $PthFile $content
        Write-Host "[Python] Enabled site-packages in ._pth"
    }

    # Install pip
    Write-Host "[Python] Installing pip..."
    $GetPipUrl = "https://bootstrap.pypa.io/get-pip.py"
    $GetPipPath = Join-Path $env:TEMP "get-pip.py"
    Invoke-WebRequest -Uri $GetPipUrl -OutFile $GetPipPath
    & $PythonExe $GetPipPath --quiet
    Remove-Item $GetPipPath
}

# ── Python packages ───────────────────────────────────────
Write-Host "[Pip] Installing airtest + pure-python-adb..."
& $PythonExe -m pip install airtest pure-python-adb --quiet 2>$null
Write-Host "[Pip] Packages installed"

# ── ADB ───────────────────────────────────────────────────
$AdbExe = Join-Path $Resources "adb\adb.exe"

if (Test-Path $AdbExe) {
    Write-Host "[ADB] Already exists, skipping download"
} else {
    Write-Host "[ADB] Downloading platform-tools..."
    $AdbUrl = "https://dl.google.com/android/repository/platform-tools-latest-windows.zip"
    $TmpZip = Join-Path $env:TEMP "autoflow-platform-tools.zip"
    $TmpDir = Join-Path $env:TEMP "autoflow-pt"
    Invoke-WebRequest -Uri $AdbUrl -OutFile $TmpZip
    Expand-Archive -Path $TmpZip -DestinationPath $TmpDir -Force

    # Copy adb + required DLLs
    Copy-Item "$TmpDir\platform-tools\adb.exe" "$Resources\adb\"
    Copy-Item "$TmpDir\platform-tools\AdbWinApi.dll" "$Resources\adb\" -ErrorAction SilentlyContinue
    Copy-Item "$TmpDir\platform-tools\AdbWinUsbApi.dll" "$Resources\adb\" -ErrorAction SilentlyContinue

    Remove-Item $TmpZip
    Remove-Item $TmpDir -Recurse -Force
    Write-Host "[ADB] Installed at $Resources\adb\"
}

# ── Engine ────────────────────────────────────────────────
Write-Host "[Engine] Copying engine.py..."
Copy-Item "$ProjectDir\engine\engine.py" "$Resources\engine\engine.py" -Force

# ── Flow templates ────────────────────────────────────────
Write-Host "[Flows] Copying flow templates..."
Copy-Item "$ProjectDir\flows\*" "$Resources\flows\" -Recurse -Force -ErrorAction SilentlyContinue

# ── Summary ───────────────────────────────────────────────
Write-Host ""
Write-Host "=== Setup Complete ==="
Write-Host "Python:  $Resources\python\"
Write-Host "ADB:     $Resources\adb\"
Write-Host "Engine:  $Resources\engine\"
Write-Host "Flows:   $Resources\flows\"
Write-Host ""

$Size = (Get-ChildItem $Resources -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ("Total size: {0:N0} MB" -f $Size)
Write-Host ""
Write-Host "Ready to build: cd $AppDir && npm run tauri build"
