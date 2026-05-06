# SnapSolve System Tray Shim
# Runs the Windows-only HTTP shim (port 3002) silently in the system tray.
# Handles /api/snip and /api/set-clipboard - identical logic to snip_shim.ps1.

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

# ── Load tray icon from icon.png (convert PNG -> Icon in memory) ──────
$iconPath = Join-Path $PSScriptRoot "extension\icon.png"
if (-not (Test-Path $iconPath)) {
    $iconPath = Join-Path $PSScriptRoot "icon.png"
}
if (Test-Path $iconPath) {
    $bitmap = [System.Drawing.Bitmap]::new($iconPath)
    $hIcon = $bitmap.GetHicon()
    $trayIcon = [System.Drawing.Icon]::FromHandle($hIcon)
} else {
    $trayIcon = [System.Drawing.SystemIcons]::Application
}

# ── Create NotifyIcon and context menu ───────────────────────────────
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $trayIcon
$notify.Text = "SnapSolve - Running on port 3002"
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = $menu.Items.Add("SnapSolve Shim - Running")
$statusItem.Enabled = $false
$menu.Items.Add("-")
$logsItem = $menu.Items.Add("Open Logs")
$logsItem.Add_Click({
    if (Test-Path $logFile) { Start-Process "notepad.exe" -ArgumentList $logFile }
})
$menu.Items.Add("-")
$exitItem = $menu.Items.Add("Exit")
$exitItem.Add_Click({
    $notify.Visible = $false
    $notify.Dispose()
    [System.Windows.Forms.Application]::Exit()
})
$notify.ContextMenuStrip = $menu

# ── Startup balloon ──────────────────────────────────────────────────
$notify.BalloonTipTitle = "SnapSolve"
$notify.BalloonTipText = "Screenshot capture is active on port 3002."
$notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$notify.ShowBalloonTip(3000)

# ── HTTP Listener logic ──────────────────────────────────────────────
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
            $contextTask = $listener.GetContextAsync()
            while (-not $contextTask.AsyncWaitHandle.WaitOne(500)) {}
            
            try {
                $context = $contextTask.GetAwaiter().GetResult()
                $request = $context.Request
                $response = $context.Response
                $urlPath = $request.Url.LocalPath

                $response.Headers.Add('Access-Control-Allow-Origin', '*')
                $response.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                $response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')

                if ($request.HttpMethod -eq 'OPTIONS') {
                    $response.StatusCode = 204
                    $response.Close()
                    continue
                }

                if ($request.HttpMethod -eq 'POST' -and $urlPath -eq '/api/set-clipboard') {
                    try {
                        $reader = New-Object System.IO.StreamReader($request.InputStream)
                        $bodyObj = $reader.ReadToEnd() | ConvertFrom-Json
                        [System.Windows.Forms.Clipboard]::SetText($bodyObj.text)
                        $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
                        $response.ContentType = 'application/json'
                        $response.OutputStream.Write($bytes, 0, $bytes.Length)
                        $response.Close()
                        Write-Log "set-clipboard OK"
                    } catch {
                        Write-Log "set-clipboard ERROR: $($_.Exception.Message)"
                        $response.Close()
                    }
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
                        $deadline = (Get-Date).AddSeconds(30)
                        $newImage = $null
                        while ((Get-Date) -lt $deadline) {
                            Start-Sleep -Milliseconds 400
                            $currentSig = Get-ClipboardSig
                            if ($currentSig -ne "none" -and $currentSig -ne $initialSig) {
                                $newImage = [System.Windows.Forms.Clipboard]::GetImage()
                                break
                            }
                        }
                        if ($null -eq $newImage) { throw "Timed out or cancelled." }
                        $ms = New-Object System.IO.MemoryStream
                        $newImage.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
                        $base64 = "data:image/png;base64," + [Convert]::ToBase64String($ms.ToArray())
                        $ms.Close()
                        $bytes = [System.Text.Encoding]::UTF8.GetBytes( (@{ image = $base64 } | ConvertTo-Json) )
                        $response.ContentType = 'application/json'
                        $response.OutputStream.Write($bytes, 0, $bytes.Length)
                        $response.Close()
                        Write-Log "snip OK"
                    } catch {
                        Write-Log "snip ERROR: $($_.Exception.Message)"
                        $response.Close()
                    }
                } else {
                    $response.StatusCode = 404
                    $response.Close()
                }
            } catch {
                Write-Log "Request error: $($_.Exception.Message)"
            }
        }
    } finally {
        $listener.Stop()
    }
}

$runspace = [RunspaceFactory]::CreateRunspace()
$runspace.ApartmentState = "STA"
$runspace.Open()
$pipeline = [PowerShell]::Create()
$pipeline.Runspace = $runspace
$pipeline.AddScript($listenerScript).AddArgument(3002).AddArgument($logFile) | Out-Null
$pipeline.BeginInvoke()

[System.Windows.Forms.Application]::Run()
$pipeline.Stop()
$runspace.Close()
$runspace.Dispose()
