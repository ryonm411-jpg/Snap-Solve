import { cleanLatex } from './utils.js';
import { API } from './config.js';

document.addEventListener('DOMContentLoaded', async () => {

    // ── Elements ─────────────────────────────────────────────
    const screenOnboarding = document.getElementById('screen-onboarding');
    const screenHome    = document.getElementById('screen-home');
    const screenResult  = document.getElementById('screen-result');
    const screenSettings = document.getElementById('screen-settings');
    const screenHistory = document.getElementById('screen-history');
    const screenChat    = document.getElementById('screen-chat');

    const modeSolve     = document.getElementById('mode-solve');
    const modeChat      = document.getElementById('mode-chat');
    const screenshotBtn = document.getElementById('screenshot-btn');
    const screenshotBtnIcon = document.getElementById('screenshot-btn-icon');
    const screenshotBtnText = document.getElementById('screenshot-btn-text');
    const settingsBtn   = document.getElementById('settings-btn');
    const historyBtn    = document.getElementById('history-btn');
    const historyBackBtn= document.getElementById('history-back-btn');
    const historyList   = document.getElementById('history-list');

    const backBtn        = document.getElementById('back-btn');
    const copyResultBtn  = document.getElementById('copy-result-btn');
    const resultLoading  = document.getElementById('result-loading');
    const resultContent  = document.getElementById('result-content');
    const resultRendered = document.getElementById('result-rendered');
    const screenshotBtn2 = document.getElementById('screenshot-btn-2');
    const resultModeTag  = document.getElementById('result-mode-tag');
    const resultStatus   = document.getElementById('result-status');

    // Chat elements
    const chatBackBtn        = document.getElementById('chat-back-btn');
    const chatNewBtn         = document.getElementById('chat-new-btn');
    const standaloneChatMessages = document.getElementById('standalone-chat-messages');
    const standaloneChatInput    = document.getElementById('standalone-chat-input');
    const standaloneChatSendBtn  = document.getElementById('standalone-chat-send-btn');
    const chatUseScreenshot      = document.getElementById('chat-use-screenshot');
    const standaloneActionBtns   = document.querySelectorAll('.standalone-action');

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

    // Onboarding elements
    const onboardFreeBtn    = document.getElementById('onboard-free-btn');
    const onboardSaveKeyBtn = document.getElementById('onboard-save-key-btn');
    const onboardProvider   = document.getElementById('onboard-provider');
    const onboardApiKey     = document.getElementById('onboard-api-key');

    // Upgrade elements
    const homeUpgradeNudge  = document.getElementById('home-upgrade-nudge');
    const homeUpgradeBtn    = document.getElementById('home-upgrade-btn');
    const settingsUpgradeCard = document.getElementById('settings-upgrade-card');
    const settingsUpgradeBtn  = document.getElementById('settings-upgrade-btn');

    let currentResult = '';
    let currentOcrText = '';
    let currentMode = 'solve';
    let currentSessionId = null;
    let chatMemory = [];
    const DAILY_LIMIT = 10;
    const MAX_SESSIONS = 20;

    function generateId() {
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }

    // ── User State Management ────────────────────────────────
    async function loadUserState() {
        const data = await chrome.storage.local.get(['hasOnboarded', 'mode', 'provider', 'apiKey']);
        return {
            hasOnboarded: !!data.hasOnboarded,
            mode: data.mode || 'default',
            provider: data.provider || 'openai',
            apiKey: data.apiKey || ''
        };
    }

    async function saveUserState(state) {
        await chrome.storage.local.set(state);
    }

    function getProviderAndKey(state) {
        if (state.mode === 'byok' && state.apiKey) {
            return { provider: state.provider, apiKey: state.apiKey };
        }
        return { provider: 'github', apiKey: undefined };
    }

    // ── Sessions Storage Helpers ──────────────────────────────
    async function getSessions() {
        const data = await chrome.storage.local.get(['sessions']);
        return data.sessions || [];
    }

    async function saveSessions(sessions) {
        // Enforce limit
        if (sessions.length > MAX_SESSIONS) {
            sessions = sessions.slice(0, MAX_SESSIONS);
        }
        await chrome.storage.local.set({ sessions });
    }

    async function addSession(session) {
        const sessions = await getSessions();
        sessions.unshift(session);
        await saveSessions(sessions);
    }

    async function updateSession(sessionId, updaterFn) {
        const sessions = await getSessions();
        const index = sessions.findIndex(s => s.id === sessionId);
        if (index !== -1) {
            updaterFn(sessions[index]);
            await saveSessions(sessions);
        }
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
        const state = await loadUserState();
        const isByok = state.mode === 'byok';

        // Rate limit bar (home)
        if (isByok) {
            rateLimitBar.style.display = 'none';
        } else {
            const count = await getRateLimit();
            rateLimitBar.style.display = 'flex';
            rateLimitText.textContent = `${count}/${DAILY_LIMIT} free solves today`;
            const pct = Math.min((count / DAILY_LIMIT) * 100, 100);
            rateLimitFill.style.width = pct + '%';
            rateLimitFill.className = 'rate-limit-fill' +
                (count >= DAILY_LIMIT ? ' full' : count >= 7 ? ' warn' : '');
        }

        // Home upgrade nudge (only for default mode)
        homeUpgradeNudge.style.display = isByok ? 'none' : 'flex';

        // Settings upgrade card (only for default mode)
        if (settingsUpgradeCard) {
            settingsUpgradeCard.style.display = isByok ? 'none' : 'flex';
        }
    }

    // ── Screen helpers ───────────────────────────────────────
    function showScreen(name) {
        screenOnboarding.classList.toggle('active', name === 'onboarding');
        screenHome.classList.toggle('active', name === 'home');
        screenResult.classList.toggle('active', name === 'result');
        screenSettings.classList.toggle('active', name === 'settings');
        screenHistory.classList.toggle('active', name === 'history');
        screenChat.classList.toggle('active', name === 'chat');
    }

    function showLoading(mode) {
        resultModeTag.textContent = 'Step-by-Step';
        currentMode = mode;
        currentSessionId = null; // Clear session on new snip
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

    function showLimitReachedCTA() {
        resultLoading.style.display = 'none';
        resultContent.style.display = 'flex';
        chatContainer.style.display = 'none';
        resultModeTag.textContent = '';
        resultStatus.textContent = '';

        resultRendered.innerHTML = `
            <div class="limit-reached-cta">
                <div class="limit-reached-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                </div>
                <span class="limit-reached-title">Daily Limit Reached</span>
                <span class="limit-reached-desc">You've used all 10 free solves for today. Upgrade for unlimited access.</span>
                <div class="limit-reached-actions">
                    <button id="limit-upgrade-btn" class="btn-primary-action">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                        Upgrade to Pro
                    </button>
                    <button id="limit-add-key-btn" class="btn-secondary-action">
                        Add Your API Key
                    </button>
                    <button id="limit-back-btn" class="btn-secondary-action" style="border: none; background: transparent; font-size: 0.75rem; margin-top: 4px; padding: 4px;">
                        Back to Home
                    </button>
                </div>
            </div>
        `;

        // Wire up the dynamically created buttons
        document.getElementById('limit-upgrade-btn').addEventListener('click', () => {
            window.open('https://buy.stripe.com/', '_blank');
        });
        document.getElementById('limit-add-key-btn').addEventListener('click', () => {
            navigateToByokSettings();
        });
        document.getElementById('limit-back-btn').addEventListener('click', () => {
            showScreen('home');
        });
    }

    async function navigateToByokSettings() {
        await loadSettingsUI();
        showScreen('settings');
        // Auto-toggle to BYOK mode so the section is visible
        toggleDefault.checked = false;
        byokSection.style.display = 'flex';
        
        // Hide the upgrade card so it doesn't clutter the BYOK setup
        if (document.getElementById('settings-upgrade-card')) {
            document.getElementById('settings-upgrade-card').style.display = 'none';
        }
        
        apiKeyInput.focus();
    }

    // ── Core: call /api/snip, then /api/ocr or /api/solve ────
    async function takeAndProcess() {
        const mode = 'solve';
        const state = await loadUserState();
        const { provider, apiKey } = getProviderAndKey(state);

        // Rate limit check (default mode)
        if (state.mode === 'default') {
            const count = await getRateLimit();
            if (count >= DAILY_LIMIT) {
                showScreen('result');
                showLimitReachedCTA();
                return;
            }
        }

        showLoading(mode);

        try {
            // 1. Ask server to open snipping tool and wait for the image
            const snipResp = await fetch(API.SNIP, {
                method: 'POST',
                signal: AbortSignal.timeout(35000)   // 35 second timeout (user has 30s to snip)
            });

            if (!snipResp.ok) throw new Error(`Snip server error ${snipResp.status}`);
            const snipData = await snipResp.json();
            if (snipData.error) throw new Error(snipData.error);

            const base64Image = snipData.image;  // Already data:image/png;base64,...

            // 2. OCR
            const ocrResp = await fetch(API.OCR, {
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

            // 3. Solve it (with image context)
            const solveResp = await fetch(API.SOLVE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: extracted, image: base64Image, provider, apiKey })
            });
            if (!solveResp.ok) throw new Error(`Solve server error ${solveResp.status}`);
            const solveData = await solveResp.json();
            if (solveData.error) throw new Error(solveData.error);
            const resultFinal = solveData.solution || '';

            // Create new session
            currentSessionId = generateId();
            await addSession({
                id: currentSessionId,
                timestamp: Date.now(),
                image: base64Image,
                ocrText: extracted,
                solution: resultFinal,
                messages: []
            });

            // Increment rate limit on successful solve (default mode only)
            if (state.mode === 'default') {
                await incrementRateLimit();
                updateRateLimitUI();
            }

            // 4. Write to clipboard via server
            await setClipboardViaServer(resultFinal);
            showResult(resultFinal, extracted);

        } catch (e) {
            if (e.name === 'TimeoutError' || e.message.includes('timed out') || e.message.includes('cancelled')) {
                showScreen('home');  // User cancelled snip, go back quietly
            } else {
                const msg = e.message === 'Failed to fetch'
                    ? 'Cannot connect to server. Is SnapSolveTray.ps1 running?'
                    : e.message;
                showError(msg);
            }
        }
    }

    // ── Chat / Follow-Up Logic ────────────────────────────────
    async function askQuestion(questionText) {
        if (!questionText.trim()) return;

        const state = await loadUserState();
        const { provider, apiKey } = getProviderAndKey(state);

        // 1. Add user message
        const userMsg = document.createElement('div');
        userMsg.className = 'chat-message user-message';
        userMsg.textContent = questionText;
        chatMessages.appendChild(userMsg);

        // 2. Clear input & disable
        chatInput.value = '';
        chatSendBtn.disabled = true;
        chatInput.disabled = true;

        // 3. Save user message to session
        if (currentSessionId) {
            await updateSession(currentSessionId, s => s.messages.push({ role: 'user', text: questionText }));
        }

        // 4. Add "Thinking..." AI message
        const aiMsg = document.createElement('div');
        aiMsg.className = 'chat-message ai-message';
        aiMsg.textContent = 'Thinking...';
        chatMessages.appendChild(aiMsg);
        
        // Auto-scroll
        chatMessages.scrollTop = chatMessages.scrollHeight;

        try {
            const askResp = await fetch(API.ASK, {
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

            // 5. Update AI message & render math
            renderMath(askData.answer, aiMsg);

            // 6. Save AI message to session
            if (currentSessionId) {
                await updateSession(currentSessionId, s => s.messages.push({ role: 'ai', text: askData.answer }));
            }

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
            await fetch(API.SET_CLIPBOARD, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
        } catch (e) {
            // Fallback to browser API if server is unreachable
            try { await navigator.clipboard.writeText(text); } catch {}
        }
    }

    // ── Standalone AI Chat Logic ────────────────────────────
    function updateModeUI() {
        if (modeChat.checked) {
            screenshotBtnText.textContent = 'Open Chat';
            screenshotBtnIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
        } else {
            screenshotBtnText.textContent = 'Take Screenshot';
            screenshotBtnIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
        }
    }

    modeSolve.addEventListener('change', updateModeUI);
    modeChat.addEventListener('change', updateModeUI);

    async function submitChatMessage(text) {
        if (!text.trim()) return;

        const state = await loadUserState();
        const { provider, apiKey } = getProviderAndKey(state);

        // Hide empty state if present
        const emptyState = standaloneChatMessages.querySelector('.history-empty');
        if (emptyState) emptyState.remove();

        // Add user message
        const userMsg = document.createElement('div');
        userMsg.className = 'chat-message user-message';
        userMsg.textContent = text;
        standaloneChatMessages.appendChild(userMsg);

        standaloneChatInput.value = '';
        standaloneChatInput.style.height = 'auto';
        standaloneChatSendBtn.disabled = true;
        standaloneChatInput.disabled = true;

        chatMemory.push({ role: 'user', text });

        // Add AI thinking message
        const aiMsg = document.createElement('div');
        aiMsg.className = 'chat-message ai-message';
        aiMsg.textContent = 'Thinking...';
        standaloneChatMessages.appendChild(aiMsg);
        
        standaloneChatMessages.scrollTop = standaloneChatMessages.scrollHeight;

        try {
            let ocrContext = '';
            let solutionContext = '';

            if (chatUseScreenshot.checked) {
                ocrContext = currentOcrText || '';
                solutionContext = currentResult || '';
            }

            const askResp = await fetch(API.ASK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: text,
                    ocrText: ocrContext,
                    solutionText: solutionContext,
                    provider,
                    apiKey
                })
            });

            if (!askResp.ok) throw new Error(`Server error ${askResp.status}`);
            const askData = await askResp.json();
            if (askData.error) throw new Error(askData.error);

            renderMath(askData.answer, aiMsg);
            chatMemory.push({ role: 'ai', text: askData.answer });

        } catch (e) {
            aiMsg.textContent = 'Error: ' + e.message;
            aiMsg.style.color = '#fa5252';
        } finally {
            standaloneChatSendBtn.disabled = false;
            standaloneChatInput.disabled = false;
            standaloneChatInput.focus();
            standaloneChatMessages.scrollTop = standaloneChatMessages.scrollHeight;
        }
    }

    // ── History Logic ────────────────────────────────────────
    async function loadHistoryUI() {
        showScreen('history');
        const sessions = await getSessions();
        historyList.innerHTML = '';

        if (sessions.length === 0) {
            historyList.innerHTML = `
                <div class="history-empty">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted); opacity: 0.5;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <span>No saved problems yet.</span>
                    <span style="font-size: 0.7rem;">Take a screenshot to get started!</span>
                </div>
            `;
            return;
        }

        const now = Date.now();
        sessions.forEach(session => {
            const el = document.createElement('div');
            el.className = 'history-card';
            
            const diffMin = Math.floor((now - session.timestamp) / 60000);
            let timeStr = diffMin < 1 ? 'Just now' : diffMin < 60 ? `${diffMin} min ago` : diffMin < 1440 ? `${Math.floor(diffMin/60)} hrs ago` : `${Math.floor(diffMin/1440)} days ago`;

            // Strip markdown/latex for preview
            const plainPreview = (session.solution || session.ocrText || '').replace(/[#$*_]/g, '').trim();

            el.innerHTML = `
                <div class="history-card-icon">∑</div>
                <div class="history-card-body">
                    <span class="history-card-preview">${plainPreview}</span>
                    <div class="history-card-meta">
                        <span>Step-by-Step</span>
                        <span class="dot"></span>
                        <span>${timeStr}</span>
                    </div>
                </div>
                <svg class="history-card-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            `;
            
            el.addEventListener('click', () => loadSession(session));
            historyList.appendChild(el);
        });
    }

    function loadSession(session) {
        showScreen('result');
        currentSessionId = session.id;
        currentMode = 'solve';
        currentOcrText = session.ocrText;
        
        resultModeTag.textContent = 'Saved Problem';
        resultStatus.textContent = '';
        
        // Show result
        showResult(session.solution, session.ocrText);
        
        // Render chat messages
        chatMessages.innerHTML = '';
        if (session.messages && session.messages.length > 0) {
            session.messages.forEach(msg => {
                const bubble = document.createElement('div');
                bubble.className = `chat-message ${msg.role}-message`;
                if (msg.role === 'ai') {
                    renderMath(msg.text, bubble);
                } else {
                    bubble.textContent = msg.text;
                }
                chatMessages.appendChild(bubble);
            });
        }
        
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // ── Settings logic ───────────────────────────────────────
    async function loadSettingsUI() {
        const state = await loadUserState();
        toggleDefault.checked = (state.mode === 'default');
        byokSection.style.display = (state.mode === 'default') ? 'none' : 'flex';
        providerSelect.value = state.provider;
        apiKeyInput.value = state.apiKey;
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

    toggleDefault.addEventListener('change', async () => {
        const isDefault = toggleDefault.checked;
        byokSection.style.display = isDefault ? 'none' : 'flex';
        
        if (isDefault) {
            const state = await loadUserState();
            state.mode = 'default';
            await saveUserState(state);
            updateRateLimitUI();
            showSettingsStatus('✓ Switched to Free Tier', 'success');
        }
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

        await saveUserState({ hasOnboarded: true, mode, provider, apiKey: key });
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
            const resp = await fetch(API.SOLVE, {
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

    // ── Onboarding Logic ──────────────────────────────────
    onboardFreeBtn.addEventListener('click', async () => {
        await saveUserState({ hasOnboarded: true, mode: 'default', provider: 'openai', apiKey: '' });
        showScreen('home');
        updateRateLimitUI();
    });

    onboardSaveKeyBtn.addEventListener('click', async () => {
        const provider = onboardProvider.value;
        const key = onboardApiKey.value.trim();
        if (!key) {
            onboardApiKey.style.borderColor = '#ef4444';
            onboardApiKey.setAttribute('placeholder', 'Please enter your key');
            setTimeout(() => {
                onboardApiKey.style.borderColor = '#334155';
                onboardApiKey.setAttribute('placeholder', 'sk-... or your key');
            }, 2000);
            return;
        }
        await saveUserState({ hasOnboarded: true, mode: 'byok', provider, apiKey: key });
        showScreen('home');
        updateRateLimitUI();
    });

    // ── Buttons ───────────────────────────────────────────────
    screenshotBtn.addEventListener('click', () => {
        if (modeChat.checked) {
            showScreen('chat');
            standaloneChatInput.focus();
        } else {
            takeAndProcess();
        }
    });
    screenshotBtn2.addEventListener('click', takeAndProcess);
    backBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showScreen('home'); });
    settingsBtn.addEventListener('click', () => { loadSettingsUI(); showScreen('settings'); });
    settingsBackBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showScreen('home'); });
    historyBtn.addEventListener('click', loadHistoryUI);
    historyBackBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showScreen('home'); });

    // AI Chat UI listeners
    chatBackBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showScreen('home'); });
    chatNewBtn.addEventListener('click', (e) => {
        e.preventDefault();
        chatMemory = [];
        standaloneChatMessages.innerHTML = `
            <div class="history-empty" style="margin-top: auto; margin-bottom: auto; padding: 20px;">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted); opacity: 0.5;"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                <span>Ask anything!</span>
                <span style="font-size: 0.7rem; text-align: center;">I can help with math, coding, science, and more.</span>
            </div>
        `;
        standaloneChatInput.value = '';
        standaloneChatInput.style.height = 'auto';
        standaloneChatInput.focus();
    });

    standaloneChatSendBtn.addEventListener('click', () => submitChatMessage(standaloneChatInput.value));
    
    standaloneChatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitChatMessage(standaloneChatInput.value);
        }
    });

    standaloneChatInput.addEventListener('input', () => {
        standaloneChatInput.style.height = 'auto';
        standaloneChatInput.style.height = (standaloneChatInput.scrollHeight) + 'px';
    });

    standaloneActionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            standaloneChatInput.value = btn.textContent;
            submitChatMessage(standaloneChatInput.value);
        });
    });

    // Upgrade buttons
    homeUpgradeBtn.addEventListener('click', () => window.open('https://buy.stripe.com/', '_blank'));
    settingsUpgradeBtn.addEventListener('click', () => window.open('https://buy.stripe.com/', '_blank'));

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
    async function initializeStartupScreen() {
        const state = await loadUserState();
        if (!state.hasOnboarded) {
            showScreen('onboarding');
        } else {
            showScreen('home');
        }
        updateRateLimitUI();

        // Restore state if popup was closed and re-opened
        if (state.hasOnboarded) {
            const { popupState, lastResult, lastOcrText } = await chrome.storage.session.get(
                ['popupState', 'lastResult', 'lastOcrText']
            );
            if (popupState === 'result' && lastResult) {
                showResult(lastResult, lastOcrText);
            } else if (popupState === 'armed') {
                showLoading('copy');
            }
        }
    }

    initializeStartupScreen();
});
