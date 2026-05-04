import { cleanLatex } from './utils.js';

document.addEventListener('DOMContentLoaded', async () => {

    // ── Elements ─────────────────────────────────────────────
    const screenHome    = document.getElementById('screen-home');
    const screenResult  = document.getElementById('screen-result');
    const screenSettings = document.getElementById('screen-settings');

    const modeSolve     = document.getElementById('mode-solve');
    const screenshotBtn = document.getElementById('screenshot-btn');
    const settingsBtn   = document.getElementById('settings-btn');

    const backBtn        = document.getElementById('back-btn');
    const copyResultBtn  = document.getElementById('copy-result-btn');
    const resultLoading  = document.getElementById('result-loading');
    const resultContent  = document.getElementById('result-content');
    const resultRendered = document.getElementById('result-rendered');
    const screenshotBtn2 = document.getElementById('screenshot-btn-2');
    const resultModeTag  = document.getElementById('result-mode-tag');
    const resultStatus   = document.getElementById('result-status');

    // Settings elements
    const settingsBackBtn  = document.getElementById('settings-back-btn');
    const toggleDefault    = document.getElementById('toggle-default');
    const byokSection      = document.getElementById('byok-section');
    const providerSelect   = document.getElementById('provider-select');
    const apiKeyInput      = document.getElementById('api-key-input');
    const toggleKeyVis     = document.getElementById('toggle-key-vis');
    const saveKeyBtn       = document.getElementById('save-key-btn');
    const testKeyBtn       = document.getElementById('test-key-btn');
    const settingsStatus   = document.getElementById('settings-status');

    // Rate limit elements
    const rateLimitBar  = document.getElementById('rate-limit-bar');
    const rateLimitText = document.getElementById('rate-limit-text');
    const rateLimitFill = document.getElementById('rate-limit-fill');

    // Chat elements
    const chatContainer   = document.getElementById('chat-container');
    const chatMessages    = document.getElementById('chat-messages');
    const chatInput       = document.getElementById('chat-input');
    const chatSendBtn     = document.getElementById('chat-send-btn');
    const quickActionBtns = document.querySelectorAll('.quick-action-btn');

    let currentResult = '';
    let currentOcrText = '';
    let currentMode = 'copy';
    const DAILY_LIMIT = 10;

    // ── Config management ────────────────────────────────────
    async function loadConfig() {
        const data = await chrome.storage.local.get(['mode', 'provider', 'apiKey']);
        return {
            mode: data.mode || 'default',
            provider: data.provider || 'openai',
            apiKey: data.apiKey || ''
        };
    }

    async function saveConfig(config) {
        await chrome.storage.local.set(config);
    }

    function getProviderAndKey(config) {
        if (config.mode === 'byok' && config.apiKey) {
            return { provider: config.provider, apiKey: config.apiKey };
        }
        return { provider: 'github', apiKey: undefined };
    }

    // ── Rate limiting (default mode only) ────────────────────
    async function getRateLimit() {
        const data = await chrome.storage.local.get(['dailyCount', 'lastReset']);
        const today = new Date().toISOString().split('T')[0];
        if (data.lastReset !== today) {
            await chrome.storage.local.set({ dailyCount: 0, lastReset: today });
            return 0;
        }
        return data.dailyCount || 0;
    }

    async function incrementRateLimit() {
        const count = await getRateLimit();
        const today = new Date().toISOString().split('T')[0];
        await chrome.storage.local.set({ dailyCount: count + 1, lastReset: today });
        return count + 1;
    }

    async function updateRateLimitUI() {
        const config = await loadConfig();
        if (config.mode === 'byok') {
            rateLimitBar.style.display = 'none';
            return;
        }
        const count = await getRateLimit();
        rateLimitBar.style.display = 'flex';
        rateLimitText.textContent = `${count}/${DAILY_LIMIT} free solves today`;
        const pct = Math.min((count / DAILY_LIMIT) * 100, 100);
        rateLimitFill.style.width = pct + '%';
        rateLimitFill.className = 'rate-limit-fill' +
            (count >= DAILY_LIMIT ? ' full' : count >= 7 ? ' warn' : '');
    }

    // ── Screen helpers ───────────────────────────────────────
    function showScreen(name) {
        screenHome.classList.toggle('active', name === 'home');
        screenResult.classList.toggle('active', name === 'result');
        screenSettings.classList.toggle('active', name === 'settings');
    }

    function showLoading(mode) {
        resultModeTag.textContent = mode === 'solve' ? 'Step-by-Step' : 'Copy Question';
        currentMode = mode;
        resultLoading.style.display = 'flex';
        resultContent.style.display = 'none';
        chatContainer.style.display = 'none';
        chatMessages.innerHTML = ''; // clear previous chat
        resultStatus.textContent = '';
        showScreen('result');
    }

    function showResult(text, ocrText) {
        currentResult = text;
        if (ocrText) currentOcrText = ocrText;
        renderMath(text, resultRendered);
        resultLoading.style.display = 'none';
        resultContent.style.display = 'flex';
        if (currentMode === 'solve') {
            chatContainer.style.display = 'flex';
        } else {
            chatContainer.style.display = 'none';
        }
    }

    // ── ChatGPT-style renderer (Markdown + KaTeX) ──────────────
    function renderMath(text, container) {
        // 1. Normalize LaTeX delimiters: \[...\] → $$...$$, \(...\) → $...$
        let src = text
            .replace(/\\\[/g, '$$')
            .replace(/\\\]/g, '$$')
            .replace(/\\\(/g, '$')
            .replace(/\\\)/g, '$');

        // 2. Extract math blocks so markdown processing doesn't corrupt them
        const mathBlocks = [];
        // Display math $$...$$  (may span lines)
        src = src.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => {
            mathBlocks.push({ display: true, tex: m.trim() });
            return `%%MATH_${mathBlocks.length - 1}%%`;
        });
        // Inline math $...$  (single line, non-greedy)
        src = src.replace(/\$([^\$\n]+?)\$/g, (_, m) => {
            mathBlocks.push({ display: false, tex: m.trim() });
            return `%%MATH_${mathBlocks.length - 1}%%`;
        });

        // 3. Convert markdown to HTML (line by line)
        const lines = src.split('\n');
        let html = '';
        let inOl = false;
        let inCode = false;
        let codeContent = [];

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // Code block toggle
            if (/^```/.test(line.trim())) {
                if (inOl) { html += '</ol>'; inOl = false; }
                if (inCode) {
                    html += `<pre><code>${codeContent.join('\n').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
                    inCode = false;
                    codeContent = [];
                } else {
                    inCode = true;
                }
                continue;
            }

            if (inCode) {
                codeContent.push(line);
                continue;
            }

            // Horizontal rule
            if (/^-{3,}\s*$/.test(line)) {
                if (inOl) { html += '</ol>'; inOl = false; }
                html += '<hr>';
                continue;
            }

            // Headers (### → h3, ## → h2, etc.)
            const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
            if (headerMatch) {
                if (inOl) { html += '</ol>'; inOl = false; }
                const level = headerMatch[1].length;
                html += `<h${level}>${mdInline(headerMatch[2])}</h${level}>`;
                continue;
            }

            // Ordered list item (1. 2. 3.)
            const olMatch = line.match(/^(\d+)\.\s+(.*)$/);
            if (olMatch) {
                if (!inOl) { html += '<ol>'; inOl = true; }
                html += `<li>${mdInline(olMatch[2])}</li>`;
                continue;
            }

            // Unordered list item (- item)
            const ulMatch = line.match(/^-\s+(.*)$/);
            if (ulMatch) {
                if (inOl) { html += '</ol>'; inOl = false; }
                html += `<li class="ul-item">${mdInline(ulMatch[1])}</li>`;
                continue;
            }

            // Close list if we hit a non-list line
            if (inOl) { html += '</ol>'; inOl = false; }

            // Empty line → spacing
            if (line.trim() === '') {
                html += '<div class="md-spacer"></div>';
                continue;
            }

            // Regular paragraph
            html += `<p>${mdInline(line)}</p>`;
        }
        if (inOl) html += '</ol>';

        // 4. Inline markdown: **bold**, *italic*, `code`
        function mdInline(s) {
            return s
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/`([^`]+)`/g, '<code>$1</code>');
        }

        // 5. Reinsert math blocks
        html = html.replace(/%%MATH_(\d+)%%/g, (_, idx) => {
            const block = mathBlocks[parseInt(idx)];
            if (block.display) {
                return `<span class="katex-display-placeholder" data-tex="${escAttr(block.tex)}"></span>`;
            } else {
                return `<span class="katex-inline-placeholder" data-tex="${escAttr(block.tex)}"></span>`;
            }
        });

        function escAttr(s) {
            return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        // 6. Set HTML and render KaTeX on placeholders
        container.innerHTML = html;
        container.style.whiteSpace = 'normal';

        container.querySelectorAll('.katex-display-placeholder').forEach(el => {
            try {
                katex.render(el.dataset.tex, el, { displayMode: true, throwOnError: false });
            } catch (e) {
                el.textContent = '$$' + el.dataset.tex + '$$';
            }
        });
        container.querySelectorAll('.katex-inline-placeholder').forEach(el => {
            try {
                katex.render(el.dataset.tex, el, { displayMode: false, throwOnError: false });
            } catch (e) {
                el.textContent = '$' + el.dataset.tex + '$';
            }
        });

        // 7. Apply highlight.js to code blocks
        if (window.hljs) {
            container.querySelectorAll('pre code').forEach(el => {
                window.hljs.highlightElement(el);
            });
        }
    }

    function showError(msg) {
        resultLoading.style.display = 'none';
        resultStatus.textContent = msg;
        resultStatus.className = 'status error';
    }

    // ── Core: call /api/snip, then /api/ocr or /api/solve ────
    async function takeAndProcess() {
        const mode = modeSolve.checked ? 'solve' : 'copy';
        const config = await loadConfig();
        const { provider, apiKey } = getProviderAndKey(config);

        // Rate limit check (default mode, solve only)
        if (config.mode === 'default' && mode === 'solve') {
            const count = await getRateLimit();
            if (count >= DAILY_LIMIT) {
                showScreen('result');
                showError('Free limit reached (10/day). Add your own API key in Settings for unlimited use.');
                return;
            }
        }

        showLoading(mode);

        try {
            // 1. Ask server to open snipping tool and wait for the image
            const snipResp = await fetch('http://localhost:3000/api/snip', {
                method: 'POST',
                signal: AbortSignal.timeout(35000)   // 35 second timeout (user has 30s to snip)
            });

            if (!snipResp.ok) throw new Error(`Snip server error ${snipResp.status}`);
            const snipData = await snipResp.json();
            if (snipData.error) throw new Error(snipData.error);

            const base64Image = snipData.image;  // Already data:image/png;base64,...

            // 2. OCR
            const ocrResp = await fetch('http://localhost:3000/api/ocr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Image, provider, apiKey })
            });

            if (!ocrResp.ok) {
                const errBody = await ocrResp.json().catch(() => ({}));
                throw new Error(errBody.error || `OCR server error ${ocrResp.status}`);
            }
            const ocrData = await ocrResp.json();
            if (ocrData.error) throw new Error(ocrData.error);

            const extracted = ocrData.ParsedResults?.[0]?.ParsedText || '';
            if (!extracted.trim()) throw new Error('No text found in the screenshot.');

            let resultFinal = '';

            if (mode === 'solve') {
                // 3a. Solve it (now with image context!)
                const solveResp = await fetch('http://localhost:3000/api/solve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question: extracted, image: base64Image, provider, apiKey })
                });
                if (!solveResp.ok) throw new Error(`Solve server error ${solveResp.status}`);
                const solveData = await solveResp.json();
                if (solveData.error) throw new Error(solveData.error);
                resultFinal = solveData.solution || '';

                // Increment rate limit on successful solve (default mode only)
                if (config.mode === 'default') {
                    await incrementRateLimit();
                    updateRateLimitUI();
                }
            } else {
                // 3b. Just use the extracted text (the OCR prompt already formats it as LaTeX)
                resultFinal = extracted;
            }

            // 4. Write to clipboard via server (avoids Chrome focus restriction)
            await setClipboardViaServer(resultFinal);
            showResult(resultFinal, extracted);

        } catch (e) {
            if (e.name === 'TimeoutError' || e.message.includes('timed out') || e.message.includes('cancelled')) {
                showScreen('home');  // User cancelled snip, go back quietly
            } else {
                const msg = e.message === 'Failed to fetch'
                    ? 'Cannot connect to server. Is start_server.ps1 running?'
                    : e.message;
                showError(msg);
            }
        }
    }

    // ── Chat / Follow-Up Logic ────────────────────────────────
    async function askQuestion(questionText) {
        if (!questionText.trim()) return;

        const config = await loadConfig();
        const { provider, apiKey } = getProviderAndKey(config);

        // 1. Add user message
        const userMsg = document.createElement('div');
        userMsg.className = 'chat-message user-message';
        userMsg.textContent = questionText;
        chatMessages.appendChild(userMsg);

        // 2. Clear input & disable
        chatInput.value = '';
        chatSendBtn.disabled = true;
        chatInput.disabled = true;

        // 3. Add "Thinking..." AI message
        const aiMsg = document.createElement('div');
        aiMsg.className = 'chat-message ai-message';
        aiMsg.textContent = 'Thinking...';
        chatMessages.appendChild(aiMsg);
        
        // Auto-scroll
        chatMessages.scrollTop = chatMessages.scrollHeight;

        try {
            const askResp = await fetch('http://localhost:3000/api/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: questionText,
                    ocrText: currentOcrText,
                    solutionText: currentResult,
                    provider,
                    apiKey
                })
            });

            if (!askResp.ok) throw new Error(`Server error ${askResp.status}`);
            const askData = await askResp.json();
            if (askData.error) throw new Error(askData.error);

            // 4. Update AI message & render math
            renderMath(askData.answer, aiMsg);

        } catch (e) {
            aiMsg.textContent = 'Error: ' + e.message;
            aiMsg.style.color = '#fa5252';
        } finally {
            chatSendBtn.disabled = false;
            chatInput.disabled = false;
            chatInput.focus();
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    // ── Helper: write to clipboard via server ────────────────
    async function setClipboardViaServer(text) {
        try {
            await fetch('http://localhost:3000/api/set-clipboard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
        } catch (e) {
            // Fallback to browser API if server is unreachable
            try { await navigator.clipboard.writeText(text); } catch {}
        }
    }

    // ── Settings logic ───────────────────────────────────────
    async function loadSettingsUI() {
        const config = await loadConfig();
        toggleDefault.checked = (config.mode === 'default');
        byokSection.style.display = (config.mode === 'default') ? 'none' : 'flex';
        providerSelect.value = config.provider;
        apiKeyInput.value = config.apiKey;
        settingsStatus.textContent = '';
    }

    function showSettingsStatus(msg, type) {
        settingsStatus.textContent = msg;
        settingsStatus.className = `status ${type}`;
        if (type === 'success') {
            setTimeout(() => {
                if (settingsStatus.textContent === msg) settingsStatus.textContent = '';
            }, 3000);
        }
    }

    toggleDefault.addEventListener('change', () => {
        byokSection.style.display = toggleDefault.checked ? 'none' : 'flex';
    });

    toggleKeyVis.addEventListener('click', () => {
        const isPassword = apiKeyInput.type === 'password';
        apiKeyInput.type = isPassword ? 'text' : 'password';
    });

    saveKeyBtn.addEventListener('click', async () => {
        const mode = toggleDefault.checked ? 'default' : 'byok';
        const provider = providerSelect.value;
        const key = apiKeyInput.value.trim();

        if (mode === 'byok' && !key) {
            showSettingsStatus('Please enter an API key.', 'error');
            return;
        }

        await saveConfig({ mode, provider, apiKey: key });
        showSettingsStatus('✓ Settings saved', 'success');
        updateRateLimitUI();
    });

    testKeyBtn.addEventListener('click', async () => {
        const provider = providerSelect.value;
        const key = apiKeyInput.value.trim();

        if (!key) {
            showSettingsStatus('Enter an API key first.', 'error');
            return;
        }

        testKeyBtn.textContent = 'Testing...';
        testKeyBtn.disabled = true;

        try {
            const resp = await fetch('http://localhost:3000/api/solve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: 'What is 2+2? Answer with just the number.', provider, apiKey: key }),
                signal: AbortSignal.timeout(15000)
            });

            const data = await resp.json();
            if (data.error) throw new Error(data.error);
            if (data.solution && data.solution.includes('4')) {
                showSettingsStatus('✅ Connection successful!', 'success');
            } else {
                showSettingsStatus('⚠️ Got a response but it seems unusual.', 'error');
            }
        } catch (e) {
            const msg = e.message === 'Failed to fetch'
                ? 'Cannot connect to server.'
                : e.message;
            showSettingsStatus('❌ ' + msg, 'error');
        } finally {
            testKeyBtn.textContent = 'Test Connection';
            testKeyBtn.disabled = false;
        }
    });

    // ── Buttons ───────────────────────────────────────────────
    screenshotBtn.addEventListener('click', takeAndProcess);
    screenshotBtn2.addEventListener('click', takeAndProcess);
    backBtn.addEventListener('click', () => showScreen('home'));
    settingsBtn.addEventListener('click', () => { loadSettingsUI(); showScreen('settings'); });
    settingsBackBtn.addEventListener('click', () => showScreen('home'));

    copyResultBtn.addEventListener('click', async () => {
        if (!currentResult) return;
        await setClipboardViaServer(currentResult);
        const origHTML = copyResultBtn.innerHTML;
        copyResultBtn.classList.add('copied');
        copyResultBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        setTimeout(() => {
            copyResultBtn.classList.remove('copied');
            copyResultBtn.innerHTML = origHTML;
        }, 2000);
    });

    chatSendBtn.addEventListener('click', () => askQuestion(chatInput.value));
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') askQuestion(chatInput.value);
    });

    quickActionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            chatInput.value = btn.textContent;
            askQuestion(chatInput.value);
        });
    });

    // ── Listen for shortcut-triggered results ─────────────────
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'TRIGGER_SNIP') {
            takeAndProcess();
        } else if (message.type === 'OCR_RESULT') {
            showResult(message.text, message.ocrText);
        } else if (message.type === 'OCR_LOADING') {
            showLoading(message.mode || 'copy');
        } else if (message.type === 'OCR_ERROR') {
            showError(message.error);
        }
    });

    // ── Init ──────────────────────────────────────────────────
    showScreen('home');
    updateRateLimitUI();

    // Restore state if popup was closed and re-opened
    const { popupState, lastResult, lastOcrText } = await chrome.storage.session.get(
        ['popupState', 'lastResult', 'lastOcrText']
    );
    if (popupState === 'result' && lastResult) {
        showResult(lastResult, lastOcrText);
    } else if (popupState === 'armed') {
        showLoading('copy');
    }
});
