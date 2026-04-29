$port = 3000
$root = $PSScriptRoot

# ── INSTRUCTIONS ────────────────────────────────────────────────────────────
# 1. Go to https://github.com/settings/tokens
# 2. Generate a new "Personal Access Token (classic)" or "Fine-grained token"
# 3. Paste it inside the quotes below:
$GITHUB_TOKEN = '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'
# ────────────────────────────────────────────────────────────────────────────

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host "Server started at: http://localhost:$port" -ForegroundColor Green
Write-Host "   Serving files from: $root" -ForegroundColor Cyan
Write-Host "   GitHub Models OCR proxy active at: /api/ocr" -ForegroundColor Cyan
Write-Host "   Press Ctrl+C to stop." -ForegroundColor Yellow

# Open browser automatically
Start-Process "http://localhost:$port/single_file_app.html"

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

        # ── OCR Proxy Endpoint ─────────────────────────────────────────────
        if ($request.HttpMethod -eq 'POST' -and $urlPath -eq '/api/ocr') {
            try {
                # Read JSON body from browser
                $reader = New-Object System.IO.StreamReader($request.InputStream)
                $bodyJson = $reader.ReadToEnd()
                $bodyObj = $bodyJson | ConvertFrom-Json
                $b64Image = $bodyObj.image

                if ($GITHUB_TOKEN -eq 'YOUR-GITHUB-TOKEN-GOES-HERE') {
                    throw "Please add your GitHub Token to start_server.ps1"
                }

                # Forward to GitHub Models API (OpenAI compatible)
                $headers = @{
                    "Authorization" = "Bearer $GITHUB_TOKEN"
                    "Content-Type"  = "application/json"
                }
                
                $githubModelsBody = @{
                    model    = "gpt-4o"
                    messages = @(
                        @{
                            role    = "system"
                            content = "You are a math OCR tool. Extract the text and mathematical formulas from the image. Format equations using proper LaTeX. Output ONLY the extracted text/LaTeX and absolutely nothing else. Do not use markdown blocks like ```latex or ```."
                        },
                        @{
                            role    = "user"
                            content = @(
                                @{
                                    type      = "image_url"
                                    image_url = @{
                                        url = $b64Image
                                    }
                                }
                            )
                        }
                    )
                }

                $jsonBody = $githubModelsBody | ConvertTo-Json -Depth 10

                # Hit the GitHub inference endpoint
                $apiResp = Invoke-RestMethod -Uri 'https://models.github.ai/inference/chat/completions' `
                    -Method Post -Headers $headers -Body $jsonBody -ErrorAction Stop

                $extractedText = $apiResp.choices[0].message.content

                # Format response to match what frontend expects
                $frontendResp = @{
                    ParsedResults = @(
                        @{
                            ParsedText = $extractedText
                        }
                    )
                }
                $jsonResp = $frontendResp | ConvertTo-Json -Depth 5
                
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

            # ── Static File Server ─────────────────────────────────────────────
        }
        else {
            if ($urlPath -eq '/' -or $urlPath -eq '') { $urlPath = '/single_file_app.html' }

            $filePath = Join-Path $root $urlPath.TrimStart('/')

            if (Test-Path $filePath -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                $mimeMap = @{
                    '.html' = 'text/html; charset=utf-8'
                    '.css'  = 'text/css; charset=utf-8'
                    '.js'   = 'application/javascript; charset=utf-8'
                    '.png'  = 'image/png'
                    '.jpg'  = 'image/jpeg'
                    '.ico'  = 'image/x-icon'
                }
                $contentType = if ($mimeMap.ContainsKey($ext)) { $mimeMap[$ext] } else { 'application/octet-stream' }

                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                $response.ContentType = $contentType
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            else {
                $body = [System.Text.Encoding]::UTF8.GetBytes("404 - Not Found: $urlPath")
                $response.StatusCode = 404
                $response.ContentLength64 = $body.Length
                $response.OutputStream.Write($body, 0, $body.Length)
            }
        }

        $response.OutputStream.Close()
    }
}
finally {
    $listener.Stop()
    Write-Host "Server stopped." -ForegroundColor Red
}
