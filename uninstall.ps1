# SnapSolve Uninstaller
# Removes the startup shortcut and stops any running shim processes.

$startupFolder = [System.Environment]::GetFolderPath('Startup')
$shortcutPath  = Join-Path $startupFolder "SnapSolve.lnk"

Write-Host ""

# ── Remove the startup shortcut ──────────────────────────────────────
if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Host "  Startup shortcut removed." -ForegroundColor Green
} else {
    Write-Host "  No startup shortcut found (already removed)." -ForegroundColor Yellow
}

# ── Kill any running SnapSolve shim processes ────────────────────────
$shimProcesses = Get-Process -Name "powershell" -ErrorAction SilentlyContinue |
    Where-Object {
        try {
            $_.CommandLine -match "SnapSolveTray"
        } catch {
            $false
        }
    }

if ($shimProcesses) {
    $shimProcesses | Stop-Process -Force
    Write-Host "  Stopped running SnapSolve shim process(es)." -ForegroundColor Green
} else {
    Write-Host "  No running SnapSolve shim processes found." -ForegroundColor Yellow
}

# ── Clean up log file (optional) ─────────────────────────────────────
$logFile = Join-Path $PSScriptRoot "snapsolve_shim.log"
if (Test-Path $logFile) {
    Remove-Item $logFile -Force
    Write-Host "  Log file removed." -ForegroundColor Green
}

Write-Host ""
Write-Host "  SnapSolve has been uninstalled." -ForegroundColor Cyan
Write-Host "  The Chrome extension is not affected — only the Windows shim was removed." -ForegroundColor Gray
Write-Host ""
pause
