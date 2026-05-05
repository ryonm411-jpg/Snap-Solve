$port = 3001
$root = $PSScriptRoot

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host "SnapSolve Windows shim running on port 3001" -ForegroundColor Green
Write-Host "Node.js server must be running on port 3000" -ForegroundColor Cyan

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $urlPath = $request.Url.LocalPath

        # ── CORS Headers (required for Chrome extension cross-origin requests) ──
        $response.Headers.Add('Access-Control-Allow-Origin', '*')
        $response.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        $response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')

        # ── Handle CORS Preflight ─────────────────────────────────────────
        if ($request.HttpMethod -eq 'OPTIONS') {
            $response.StatusCode = 204
            $response.OutputStream.Close()
            continue
        }

        # ── Set Clipboard (write text from extension without focus) ───────────
        if ($request.HttpMethod -eq 'POST' -and $urlPath -eq '/api/set-clipboard') {
            try {
                $reader = New-Object System.IO.StreamReader($request.InputStream)
                $bodyJson = $reader.ReadToEnd()
                $bodyObj  = $bodyJson | ConvertFrom-Json
                $textToWrite = $bodyObj.text

                # PowerShell clipboard write — no focus restriction
                Add-Type -AssemblyName System.Windows.Forms
                [System.Windows.Forms.Clipboard]::SetText($textToWrite)

                $jsonResp = '{"success":true}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonResp)
                $response.ContentType = 'application/json; charset=utf-8'
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            catch {
                $err = '{"error":"' + ($_.Exception.Message -replace '"', '\"') + '"}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($err)
                $response.StatusCode = 500
                $response.ContentType = 'application/json; charset=utf-8'
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }

        # ── Snip Endpoint (launches Win+Shift+S equivalent) ──────────────────
        } elseif ($request.HttpMethod -eq 'POST' -and $urlPath -eq '/api/snip') {
            try {
                Add-Type -AssemblyName System.Windows.Forms
                Add-Type -AssemblyName System.Drawing

                # Helper to get a signature of current clipboard image
                function Get-ClipboardSig {
                    if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
                        $img = [System.Windows.Forms.Clipboard]::GetImage()
                        return "$($img.Width)x$($img.Height)"
                    }
                    return "none"
                }

                $initialSig = Get-ClipboardSig

                # Launch the screen region selector (same experience as Win+Shift+S)
                Start-Process "ms-screenclip:"
                Start-Sleep -Milliseconds 800

                # Poll clipboard for up to 30 seconds waiting for user to snip
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

                # Convert image to base64 PNG
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
            }
            catch {
                $err = '{"error":"' + ($_.Exception.Message -replace '"', '\"') + '"}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($err)
                $response.StatusCode = 500
                $response.ContentType = 'application/json; charset=utf-8'
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }

        } else {
            # Everything else: return 404
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
    Write-Host "Error: $_" -ForegroundColor Red
}
finally {
    $listener.Stop()
}
