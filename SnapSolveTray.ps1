# SnapSolve System Tray Shim
# Runs the Windows-only HTTP shim (port 3001) silently in the system tray.
# Handles /api/snip and /api/set-clipboard — identical logic to snip_shim.ps1.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ── Hide the console window ──────────────────────────────────────────
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$consoleHwnd = [Win32]::GetConsoleWindow()
if ($consoleHwnd -ne [IntPtr]::Zero) {
    [Win32]::ShowWindow($consoleHwnd, 0) | Out-Null   # 0 = SW_HIDE
}

# ── Log file ─────────────────────────────────────────────────────────
$logFile = Join-Path $PSScriptRoot "snapsolve_shim.log"
function Write-Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts  $msg" | Out-File -FilePath $logFile -Append -Encoding utf8
}
Write-Log "SnapSolve tray shim starting..."

# ── Load tray icon from icon.png (convert PNG → Icon in memory) ──────
$iconPath = Join-Path $PSScriptRoot "extension\icon.png"
if (-not (Test-Path $iconPath)) {
    # Fallback: try the repo root
    $iconPath = Join-Path $PSScriptRoot "icon.png"
}
if (Test-Path $iconPath) {
    $bitmap = [System.Drawing.Bitmap]::new($iconPath)
    $hIcon = $bitmap.GetHicon()
    $trayIcon = [System.Drawing.Icon]::FromHandle($hIcon)
} else {
    # Use a default system icon as last resort
    $trayIcon = [System.Drawing.SystemIcons]::Application
}

# ── Create NotifyIcon and context menu ───────────────────────────────
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $trayIcon
$notify.Text = "SnapSolve — Running on port 3001"
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$statusItem = $menu.Items.Add("SnapSolve Shim — Running")
$statusItem.Enabled = $false

$menu.Items.Add("-")  # separator

$logsItem = $menu.Items.Add("Open Logs")
$logsItem.Add_Click({
    if (Test-Path $logFile) {
        Start-Process "notepad.exe" -ArgumentList $logFile
    } else {
        [System.Windows.Forms.MessageBox]::Show("No log file found.", "SnapSolve")
    }
})

$menu.Items.Add("-")  # separator

$exitItem = $menu.Items.Add("Exit")
$exitItem.Add_Click({
    Write-Log "User requested exit from tray menu."
    $script:shutdownRequested = $true
    $notify.Visible = $false
    $notify.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$notify.ContextMenuStrip = $menu

# ── Show startup balloon ─────────────────────────────────────────────
$notify.BalloonTipTitle = "SnapSolve"
$notify.BalloonTipText = "Screenshot capture is active on port 3001."
$notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$notify.ShowBalloonTip(3000)

# ── HTTP Listener logic (runs in a background runspace) ──────────────
$script:shutdownRequested = $false

$listenerScript = {
    param($port, $logFile)

    function Write-Log($msg) {
        $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        "$ts  $msg" | Out-File -FilePath $logFile -Append -Encoding utf8
    }

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$port/")
    $listener.Start()
    Write-Log "HttpListener started on port $port"

    try {
        while ($listener.IsListening) {
            # Use async GetContext with a timeout so we can check for shutdown
            $contextTask = $listener.GetContextAsync()
            while (-not $contextTask.AsyncWaitHandle.WaitOne(500)) {
                # Check every 500ms — if parent closes, listener will stop
            }
            $context = $contextTask.GetAwaiter().GetResult()

            $request = $context.Request
            $response = $context.Response
            $urlPath = $request.Url.LocalPath

            # CORS Headers
            $response.Headers.Add('Access-Control-Allow-Origin', '*')
            $response.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            $response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')

            # CORS Preflight
            if ($request.HttpMethod -eq 'OPTIONS') {
                $response.StatusCode = 204
                $response.OutputStream.Close()
                continue
            }

            # ── /api/set-clipboard ────────────────────────────────────
            if ($request.HttpMethod -eq 'POST' -and $urlPath -eq '/api/set-clipboard') {
                try {
                    $reader = New-Object System.IO.StreamReader($request.InputStream)
                    $bodyJson = $reader.ReadToEnd()
                    $bodyObj  = $bodyJson | ConvertFrom-Json
                    $textToWrite = $bodyObj.text

                    [System.Windows.Forms.Clipboard]::SetText($textToWrite)

                    $jsonResp = '{"success":true}'
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonResp)
                    $response.ContentType = 'application/json; charset=utf-8'
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    Write-Log "set-clipboard OK"
                }
                catch {
                    $err = '{"error":"' + ($_.Exception.Message -replace '"', '\"') + '"}'
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($err)
                    $response.StatusCode = 500
                    $response.ContentType = 'application/json; charset=utf-8'
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    Write-Log "set-clipboard ERROR: $($_.Exception.Message)"
                }

            # ── /api/snip ─────────────────────────────────────────────
            } elseif ($request.HttpMethod -eq 'POST' -and $urlPath -eq '/api/snip') {
                try {
                    function Get-ClipboardSig {
                        if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
                            $img = [System.Windows.Forms.Clipboard]::GetImage()
                            return "$($img.Width)x$($img.Height)"
                        }
                        return "none"
                    }

                    $initialSig = Get-ClipboardSig
                    Start-Process "ms-screenclip:"
                    Start-Sleep -Milliseconds 800

                    $deadline = (Get-Date).AddSeconds(30)
                    $newImage = $null

                    while ((Get-Date) -lt $deadline) {
                        Start-Sleep -Milliseconds 350
                        $currentSig = Get-ClipboardSig
                        if ($currentSig -ne "none" -and $currentSig -ne $initialSig) {
                            $newImage = [System.Windows.Forms.Clipboard]::GetImage()
                            break
                        }
                    }

                    if ($null -eq $newImage) {
                        throw "No screenshot captured (timed out or cancelled)."
                    }

                    $ms = New-Object System.IO.MemoryStream
                    $newImage.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
                    $imgBytes = $ms.ToArray()
                    $ms.Close()
                    $base64 = "data:image/png;base64," + [Convert]::ToBase64String($imgBytes)

                    $jsonResp = (@{ image = $base64 } | ConvertTo-Json -Depth 3)
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonResp)
                    $response.ContentType = 'application/json; charset=utf-8'
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    Write-Log "snip OK"
                }
                catch {
                    $err = '{"error":"' + ($_.Exception.Message -replace '"', '\"') + '"}'
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($err)
                    $response.StatusCode = 500
                    $response.ContentType = 'application/json; charset=utf-8'
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    Write-Log "snip ERROR: $($_.Exception.Message)"
                }

            } else {
                # 404 for everything else
                $err = '{"error":"Endpoint not found on Windows shim"}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($err)
                $response.StatusCode = 404
                $response.ContentType = 'application/json; charset=utf-8'
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        }
    }
    catch {
        Write-Log "Listener error: $($_.Exception.Message)"
    }
    finally {
        $listener.Stop()
        Write-Log "HttpListener stopped."
    }
}

# ── Launch the listener in a background runspace ─────────────────────
$runspace = [RunspaceFactory]::CreateRunspace()
$runspace.ApartmentState = "STA"   # Required for clipboard/WinForms in the runspace
$runspace.Open()

$pipeline = [PowerShell]::Create()
$pipeline.Runspace = $runspace
$pipeline.AddScript($listenerScript).AddArgument(3001).AddArgument($logFile) | Out-Null
$asyncResult = $pipeline.BeginInvoke()

Write-Log "Background listener runspace started."

# ── Run the WinForms message loop (keeps tray icon alive) ────────────
[System.Windows.Forms.Application]::Run()

# ── Cleanup after Application.Exit() ────────────────────────────────
Write-Log "Shutting down..."
$pipeline.Stop()
$runspace.Close()
$runspace.Dispose()
Write-Log "Shutdown complete."
