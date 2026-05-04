$port = 3000
$root = $PSScriptRoot

# ── INSTRUCTIONS ────────────────────────────────────────────────────────────
# 1. Go to https://github.com/settings/tokens
# 2. Generate a new "Personal Access Token (classic)" or "Fine-grained token"
# 3. Save it in a .env file like this: GITHUB_TOKEN=your_token_here
$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)\s*=\s*(.*)\s*$') {
            Set-Item -Path "env:\$($matches[1].Trim())" -Value $matches[2].Trim()
        }
    }
    $GITHUB_TOKEN = $env:GITHUB_TOKEN
} else {
    $GITHUB_TOKEN = 'YOUR-GITHUB-TOKEN-GOES-HERE'
}
# ────────────────────────────────────────────────────────────────────────────

# ── Shared System Prompts ───────────────────────────────────────────────────
$SOLVE_PROMPT = @'
You are an expert tutor.
Explain clearly and concisely.
Use clean Markdown formatting.
Use LaTeX for all math:
- Inline: $...$
- Block: $$...$$
Structure solutions step-by-step using **Step 1:**, **Step 2:**, etc.
End with **Final Answer:** section.
Use horizontal separators (---) between sections.
Avoid unnecessary verbosity.
Ensure output is clean, readable, and copy-paste ready.
Your output must render perfectly in KaTeX.
'@

$OCR_PROMPT = 'You are an expert math formatter and OCR tool. Transcribe the text from the image exactly. STRICT FORMATTING RULES: (1) ALL math must use ONLY dollar-sign delimiters: inline $...$ and display $$...$$. (2) NEVER use backslash-bracket or backslash-paren delimiters. (3) NEVER output raw math without dollar signs - every variable like $X$, $a$, $b$ must be wrapped. Write $e^x$ not e^x, write $\frac{5}{6}$ not 5/6. (4) Convert ALL vertical or stacked fractions into $\frac{numerator}{denominator}$. (5) Use proper LaTeX: \int, \frac, \infty, \leq, \geq, \text, \begin{cases}. (6) NEVER use markdown. Output ONLY the extracted content, no commentary. Output MUST render perfectly in KaTeX.'

# ── Provider API Abstraction ────────────────────────────────────────────────
function Invoke-ProviderAPI {
    param(
        [string]$Provider,
        [string]$ApiKey,
        [string]$SystemPrompt,
        [string]$UserText,
        [string]$ImageBase64
    )

    $rawBase64 = ''
    $mimeType = 'image/png'
    if ($ImageBase64) {
        if ($ImageBase64 -match '^data:(image/[^;]+);base64,(.+)$') {
            $mimeType = $matches[1]
            $rawBase64 = $matches[2]
        } else {
            $rawBase64 = $ImageBase64
        }
    }

    switch ($Provider) {
        "github" {
            $hdrs = @{ "Authorization" = "Bearer $ApiKey"; "Content-Type" = "application/json" }
            $uc = @()
            if ($UserText)    { $uc += @{ type = "text"; text = $UserText } }
            if ($ImageBase64) { $uc += @{ type = "image_url"; image_url = @{ url = $ImageBase64 } } }
            if ($uc.Count -eq 0) { throw "No content provided" }
            $b = @{ model = "gpt-4o"; messages = @( @{ role = "system"; content = $SystemPrompt }, @{ role = "user"; content = $uc } ) }
            $r = Invoke-RestMethod -Uri 'https://models.github.ai/inference/chat/completions' -Method Post -Headers $hdrs -Body ($b | ConvertTo-Json -Depth 10) -ErrorAction Stop
            return $r.choices[0].message.content
        }
        "openai" {
            $hdrs = @{ "Authorization" = "Bearer $ApiKey"; "Content-Type" = "application/json" }
            $uc = @()
            if ($UserText)    { $uc += @{ type = "text"; text = $UserText } }
            if ($ImageBase64) { $uc += @{ type = "image_url"; image_url = @{ url = $ImageBase64 } } }
            if ($uc.Count -eq 0) { throw "No content provided" }
            $b = @{ model = "gpt-4o-mini"; messages = @( @{ role = "system"; content = $SystemPrompt }, @{ role = "user"; content = $uc } ) }
            $r = Invoke-RestMethod -Uri 'https://api.openai.com/v1/chat/completions' -Method Post -Headers $hdrs -Body ($b | ConvertTo-Json -Depth 10) -ErrorAction Stop
            return $r.choices[0].message.content
        }
        "claude" {
            $hdrs = @{ "x-api-key" = $ApiKey; "anthropic-version" = "2023-06-01"; "Content-Type" = "application/json" }
            $mc = @()
            if ($ImageBase64) { $mc += @{ type = "image"; source = @{ type = "base64"; media_type = $mimeType; data = $rawBase64 } } }
            if ($UserText)    { $mc += @{ type = "text"; text = $UserText } }
            if ($mc.Count -eq 0) { throw "No content provided" }
            $b = @{ model = "claude-sonnet-4-20250514"; max_tokens = 4096; system = $SystemPrompt; messages = @( @{ role = "user"; content = $mc } ) }
            $r = Invoke-RestMethod -Uri 'https://api.anthropic.com/v1/messages' -Method Post -Headers $hdrs -Body ($b | ConvertTo-Json -Depth 10) -ErrorAction Stop
            return $r.content[0].text
        }
        "gemini" {
            $parts = @()
            if ($ImageBase64) { $parts += @{ inlineData = @{ mimeType = $mimeType; data = $rawBase64 } } }
            if ($UserText)    { $parts += @{ text = $UserText } }
            if ($parts.Count -eq 0) { throw "No content provided" }
            $b = @{ systemInstruction = @{ parts = @(@{ text = $SystemPrompt }) }; contents = @( @{ role = "user"; parts = $parts } ) }
            $r = Invoke-RestMethod -Uri "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=$ApiKey" -Method Post -Headers @{ "Content-Type" = "application/json" } -Body ($b | ConvertTo-Json -Depth 10) -ErrorAction Stop
            return $r.candidates[0].content.parts[0].text
        }
        default { throw "Unknown provider: $Provider" }
    }
}

function Get-FriendlyError {
    param($ErrorRecord)
    $msg = $ErrorRecord.Exception.Message
    if ($msg -match '401|403|Unauthorized|Forbidden|invalid.api.key|authentication') {
        return "Invalid API key. Please check your key in Settings."
    } elseif ($msg -match '429|rate.limit|quota|too.many') {
        return "Rate limit exceeded. Please wait a moment."
    } elseif ($msg -match '5\d\d|server.error|unavailable|overloaded') {
        return "Provider unavailable. Try again later."
    }
    return $msg
}

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

        # ── OCR Proxy Endpoint ─────────────────────────────────────────────
        } elseif ($request.HttpMethod -eq 'POST' -and $urlPath -eq '/api/ocr') {
            try {
                $reader = New-Object System.IO.StreamReader($request.InputStream)
                $bodyJson = $reader.ReadToEnd()
                $bodyObj = $bodyJson | ConvertFrom-Json
                $b64Image = $bodyObj.image
                $provider = if ($bodyObj.provider) { $bodyObj.provider } else { 'github' }
                $apiKey = if ($provider -eq 'github') { $GITHUB_TOKEN } else { $bodyObj.apiKey }

                if ($provider -eq 'github' -and $GITHUB_TOKEN -eq 'YOUR-GITHUB-TOKEN-GOES-HERE') {
                    throw "Please add your GitHub Token to start_server.ps1"
                }

                $extractedText = Invoke-ProviderAPI -Provider $provider -ApiKey $apiKey -SystemPrompt $OCR_PROMPT -ImageBase64 $b64Image

                $frontendResp = @{ ParsedResults = @( @{ ParsedText = $extractedText } ) }
                $jsonResp = $frontendResp | ConvertTo-Json -Depth 5
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonResp)
                $response.ContentType = 'application/json; charset=utf-8'
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            catch {
                $err = (@{ error = (Get-FriendlyError $_) } | ConvertTo-Json -Compress)
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($err)
                $response.StatusCode = 500
                $response.ContentType = 'application/json; charset=utf-8'
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        }
        # ── Solve Endpoint ────────────────────────────────────────────────────
        elseif ($request.HttpMethod -eq 'POST' -and $urlPath -eq '/api/solve') {
            try {
                $reader = New-Object System.IO.StreamReader($request.InputStream)
                $bodyJson = $reader.ReadToEnd()
                $bodyObj = $bodyJson | ConvertFrom-Json
                $question = $bodyObj.question
                $b64Image = $bodyObj.image
                $provider = if ($bodyObj.provider) { $bodyObj.provider } else { 'github' }
                $apiKey = if ($provider -eq 'github') { $GITHUB_TOKEN } else { $bodyObj.apiKey }

                if ($provider -eq 'github' -and $GITHUB_TOKEN -eq 'YOUR-GITHUB-TOKEN-GOES-HERE') {
                    throw "Please add your GitHub Token to start_server.ps1"
                }

                $userText = ''
                if (-not [string]::IsNullOrWhiteSpace($question)) {
                    $userText = "Here is the problem:`n$question"
                }

                $solution = Invoke-ProviderAPI -Provider $provider -ApiKey $apiKey -SystemPrompt $SOLVE_PROMPT -UserText $userText -ImageBase64 $b64Image

                $jsonResp = (@{ solution = $solution } | ConvertTo-Json -Depth 3)
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonResp)
                $response.ContentType = 'application/json; charset=utf-8'
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            catch {
                $err = (@{ error = (Get-FriendlyError $_) } | ConvertTo-Json -Compress)
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($err)
                $response.StatusCode = 500
                $response.ContentType = 'application/json; charset=utf-8'
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        }
        # ── Ask Endpoint (Follow-up Questions) ────────────────────────────────
        elseif ($request.HttpMethod -eq 'POST' -and $urlPath -eq '/api/ask') {
            try {
                $reader = New-Object System.IO.StreamReader($request.InputStream)
                $bodyJson = $reader.ReadToEnd()
                $bodyObj = $bodyJson | ConvertFrom-Json
                $question = $bodyObj.question
                $ocrText = $bodyObj.ocrText
                $solutionText = $bodyObj.solutionText
                $provider = if ($bodyObj.provider) { $bodyObj.provider } else { 'github' }
                $apiKey = if ($provider -eq 'github') { $GITHUB_TOKEN } else { $bodyObj.apiKey }

                if ($provider -eq 'github' -and $GITHUB_TOKEN -eq 'YOUR-GITHUB-TOKEN-GOES-HERE') {
                    throw "Please add your GitHub Token to start_server.ps1"
                }

                $userText = "User question:`n$question`n`nContent:`n$ocrText`n`nSolution/context:`n$solutionText"

                $answer = Invoke-ProviderAPI -Provider $provider -ApiKey $apiKey -SystemPrompt $SOLVE_PROMPT -UserText $userText

                $jsonResp = (@{ answer = $answer } | ConvertTo-Json -Depth 3)
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonResp)
                $response.ContentType = 'application/json; charset=utf-8'
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            catch {
                $err = (@{ error = (Get-FriendlyError $_) } | ConvertTo-Json -Compress)
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($err)
                $response.StatusCode = 500
                $response.ContentType = 'application/json; charset=utf-8'
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
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
