Write-Host "Starting SnapSolve..." -ForegroundColor Cyan

# Ensure we're in the right directory
$root = $PSScriptRoot
Set-Location $root

# 1. Start the Node.js server
# Using Start-Process to spawn it in a separate visible window so the user can see Node logs
Write-Host "Booting Node.js Express server on Port 3000..." -ForegroundColor Yellow
# If the path environment isn't reloaded, this might fail, but assuming user fixed it:
Start-Process "node" -ArgumentList "server/index.js" -WindowStyle Normal -WorkingDirectory $root

# 2. Wait 2 seconds for Node to initialize
Start-Sleep -Seconds 2

# Print the final ready messages
Write-Host "`nReady!" -ForegroundColor Green
Write-Host "Node.js server: http://localhost:3000" -ForegroundColor Gray
Write-Host "Windows shim:   http://localhost:3001" -ForegroundColor Gray
Write-Host "Both services running. Press Ctrl+C to stop." -ForegroundColor White

# 3. Start the Windows shim in the foreground
& "$PSScriptRoot\snip_shim.ps1"
