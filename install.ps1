# SnapSolve Installer
# Creates a startup shortcut so the tray shim launches silently on Windows boot.

$shimPath = Join-Path $PSScriptRoot "SnapSolveTray.ps1"

if (-not (Test-Path $shimPath)) {
    Write-Host "ERROR: SnapSolveTray.ps1 not found in this folder." -ForegroundColor Red
    Write-Host "Make sure you are running this from the SnapSolve directory." -ForegroundColor Yellow
    pause
    exit 1
}

# ── Create the shortcut ──────────────────────────────────────────────
$startupFolder = [System.Environment]::GetFolderPath('Startup')
$shortcutPath  = Join-Path $startupFolder "SnapSolve.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$shimPath`""
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = "SnapSolve screenshot capture shim"

# Use the extension icon if available
$iconFile = Join-Path $PSScriptRoot "extension\icon.png"
if (-not (Test-Path $iconFile)) {
    $iconFile = Join-Path $PSScriptRoot "icon.png"
}
# Shortcuts need .ico, so we fall back to PowerShell's own icon
$shortcut.IconLocation = "powershell.exe,0"

$shortcut.Save()

Write-Host ""
Write-Host "  SnapSolve installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "  What happened:" -ForegroundColor Cyan
Write-Host "    - A startup shortcut was created at:"
Write-Host "      $shortcutPath" -ForegroundColor Gray
Write-Host "    - SnapSolve will now start silently every time Windows boots."
Write-Host ""

# ── Launch the tray shim right now ───────────────────────────────────
Write-Host "  Starting SnapSolve tray shim now..." -ForegroundColor Yellow
Start-Process "powershell.exe" -ArgumentList "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$shimPath`"" -WorkingDirectory $PSScriptRoot

Write-Host "  Done! Look for the SnapSolve icon in your system tray." -ForegroundColor Green
Write-Host ""
pause
