// sidepanel.js — Pure renderer. No direct API calls.
// All processing goes through background.js via messages.

document.addEventListener('DOMContentLoaded', async () => {

    // ── Elements ──────────────────────────────────────
    const screenOnboarding = document.getElementById('screen-onboarding');
    const screenHome = document.getElementById('screen-home');
    const screenResult = document.getElementById('screen-result');
    const screenSettings = document.getElementById('screen-settings');
    const screenHistory = document.getElementById('screen-history');
    const screenChat = document.getElementById('screen-chat');

    const modeSolve = document.getElementById('mode-solve');
    const modeChat = document.getElementById('mode-chat');
    const screenshotBtn = document.getElementById('screenshot-btn');
    const screenshotBtnIcon = document.getElementById('screenshot-btn-icon');
    const screenshotBtnText = document.getElementById('screenshot-btn-text');
    const settingsBtn = document.getElementById('settings-btn');
    const historyBtn = document.getElementById('history-btn');
    const historyBackBtn = document.getElementById('history-back-btn');
    const historyList = document.getElementById('history-list');

    const backBtn = document.getElementById('back-btn');
    const copyResultBtn = document.getElementById('copy-result-btn');
    const resultLoading = document.getElementById('result-loading');
    const resultLoadingText = document.getElementById('result-loading-text');
    const resultContent = document.getElementById('result-content');
    const resultRendered = document.getElementById('result-rendered');
    const screenshotBtn2 = document.getElementById('screenshot-btn-2');
    const resultModeTag = document.getElementById('result-mode-tag');
    const resultStatus = document.getElementById('result-status');

    const chatContainer = document.getElementById('chat-container');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send-btn');
    const quickActionBtns = document.querySelectorAll('.quick-action-btn');

    const chatBackBtn = document.getElementById('chat-back-btn');
    const chatNewBtn = document.getElementById('chat-new-btn');
    const standaloneChatMessages = document.getElementById('standalone-chat-messages');
    const standaloneChatInput = document.getElementById('standalone-chat-input');
    const standaloneChatSendBtn = document.getElementById('standalone-chat-send-btn');
    const standaloneChatAttachBtn = document.getElementById('standalone-chat-attach-btn');

    const settingsBackBtn = document.getElementById('settings-back-btn');
    const toggleDefault = document.getElementById('toggle-default');
    const byokSection = document.getElementById('byok-section');
    const providerSelect = document.getElementById('provider-select');
    const apiKeyInput = document.getElementById('api-key-input');
    const toggleKeyVis = document.getElementById('toggle-key-vis');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const testKeyBtn = document.getElementById('test-key-btn');
    const settingsStatus = document.getElementById('settings-status');

    const rateLimitBar = document.getElementById('rate-limit-bar');
    const rateLimitText = document.getElementById('rate-limit-text');
    const rateLimitFill = document.getElementById('rate-limit-fill');

    const onboardFreeBtn = document.getElementById('onboard-free-btn');
    const onboardSaveKeyBtn = document.getElementById('onboard-save-key-btn');
    const onboardProvider = document.getElementById('onboard-provider');
    const onboardApiKey = document.getElementById('onboard-api-key');

    const homeUpgradeNudge = document.getElementById('home-upgrade-nudge');
    const homeUpgradeBtn = document.getElementById('home-upgrade-btn');

    let currentResult = '';
    let currentOcrText = '';
    let currentSessionId = null;
    let chatSessionId = null;

    // ── Screen Navigation ─────────────────────────────
    function showScreen(name) {
        screenOnboarding.classList.toggle('active', name === 'onboarding');
        screenHome.classList.toggle('active', name === 'home');
        screenResult.classList.toggle('active', name === 'result');
        screenSettings.classList.toggle('active', name === 'settings');
        screenHistory.classList.toggle('active', name === 'history');
        screenChat.classList.toggle('active', name === 'chat');
    }

    // ── Loading / Result Display ──────────────────────
    function showLoading(mode) {
        resultModeTag.textContent = mode === 'solve' ? 'Step-by-Step' : 'Copy Question';
        resultLoadingText.textContent = 'Processing...';
        resultLoading.style.display = 'flex';
        resultContent.style.display = 'none';
        chatContainer.style.display = 'none';
        chatMessages.innerHTML = '';
        resultStatus.textContent = '';
        showScreen('result');
    }

    function showResult(text, ocrText) {
        currentResult = text;
        if (ocrText) currentOcrText = ocrText;
        renderMath(text, resultRendered);
        resultLoading.style.display = 'none';
        resultContent.style.display = 'flex';
        chatContainer.style.display = 'flex';
    }

    function showError(msg) {
        resultLoading.style.display = 'none';
        resultStatus.textContent = msg;
        resultStatus.className = 'status error';
    }

    // ── Markdown + KaTeX Renderer ─────────────────────
    function renderMath(text, container) {
        let src = text
            .replace(/\\\[/g, '$$').replace(/\\\]/g, '$$')
            .replace(/\\\(/g, '$').replace(/\\\)/g, '$');

        const mathBlocks = [];
        src = src.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => {
            mathBlocks.push({ display: true, tex: m.trim() });
            return `%%MATH_${mathBlocks.length - 1}%%`;
        });
        src = src.replace(/\$([^\$\n]+?)\$/g, (_, m) => {
            mathBlocks.push({ display: false, tex: m.trim() });
            return `%%MATH_${mathBlocks.length - 1}%%`;
        });

        const lines = src.split('\n');
        let html = '';
        let inOl = false, inCode = false;
        let codeContent = [];

        for (const line of lines) {
            if (/^```/.test(line.trim())) {
                if (inOl) { html += '</ol>'; inOl = false; }
                if (inCode) {
                    html += `<pre><code>${codeContent.join('\n').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
                    inCode = false; codeContent = [];
                } else { inCode = true; }
                continue;
            }
            if (inCode) { codeContent.push(line); continue; }
            if (/^-{3,}\s*$/.test(line)) { if (inOl) { html += '</ol>'; inOl = false; } html += '<hr>'; continue; }

            const hm = line.match(/^(#{1,6})\s+(.*)$/);
            if (hm) { if (inOl) { html += '</ol>'; inOl = false; } html += `<h${hm[1].length}>${mdInline(hm[2])}</h${hm[1].length}>`; continue; }

            const olm = line.match(/^(\d+)\.\s+(.*)$/);
            if (olm) { if (!inOl) { html += '<ol>'; inOl = true; } html += `<li>${mdInline(olm[2])}</li>`; continue; }

            const ulm = line.match(/^-\s+(.*)$/);
            if (ulm) { if (inOl) { html += '</ol>'; inOl = false; } html += `<li>${mdInline(ulm[1])}</li>`; continue; }

            if (inOl) { html += '</ol>'; inOl = false; }
            if (line.trim() === '') { html += '<div class="md-spacer"></div>'; continue; }
            html += `<p>${mdInline(line)}</p>`;
        }
        if (inOl) html += '</ol>';

        function mdInline(s) {
            return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/`([^`]+)`/g, '<code>$1</code>');
        }

        function escAttr(s) { return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

        html = html.replace(/%%MATH_(\d+)%%/g, (_, idx) => {
            const b = mathBlocks[parseInt(idx)];
            return b.display
                ? `<span class="katex-display-placeholder" data-tex="${escAttr(b.tex)}"></span>`
                : `<span class="katex-inline-placeholder" data-tex="${escAttr(b.tex)}"></span>`;
        });

        container.innerHTML = html;
        container.style.whiteSpace = 'normal';

        container.querySelectorAll('.katex-display-placeholder').forEach(el => {
            try { katex.render(el.dataset.tex, el, { displayMode: true, throwOnError: false }); }
            catch { el.textContent = '$$' + el.dataset.tex + '$$'; }
        });
        container.querySelectorAll('.katex-inline-placeholder').forEach(el => {
            try { katex.render(el.dataset.tex, el, { displayMode: false, throwOnError: false }); }
            catch { el.textContent = '$' + el.dataset.tex + '$'; }
        });
        if (window.hljs) container.querySelectorAll('pre code').forEach(el => window.hljs.highlightElement(el));
    }

    // ── Rate Limit UI ─────────────────────────────────
    async function updateRateLimitUI() {
        const config = await chrome.storage.local.get(['mode']);
        const isByok = config.mode === 'byok';
        if (isByok) { rateLimitBar.style.display = 'none'; homeUpgradeNudge.style.display = 'none'; return; }

        try {
            const resp = await chrome.runtime.sendMessage({ target: 'background', type: 'GET_RATE_LIMIT' });
            rateLimitBar.style.display = 'flex';
            rateLimitText.textContent = `${resp.count}/${resp.limit} free solves today`;
            const pct = Math.min((resp.count / resp.limit) * 100, 100);
            rateLimitFill.style.width = pct + '%';
            rateLimitFill.className = 'rate-limit-fill' + (resp.count >= resp.limit ? ' full' : resp.count >= 7 ? ' warn' : '');
        } catch { /* background not ready */ }
        homeUpgradeNudge.style.display = 'flex';
    }

    // ── Follow-up Chat (result screen) ────────────────
    async function askFollowUp(text) {
        if (!text.trim()) return;
        const userMsg = document.createElement('div');
        userMsg.className = 'chat-message user-message';
        userMsg.textContent = text;
        chatMessages.appendChild(userMsg);
        chatInput.value = '';
        chatSendBtn.disabled = true;
        chatInput.disabled = true;

        const aiMsg = document.createElement('div');
        aiMsg.className = 'chat-message ai-message';
        aiMsg.textContent = 'Thinking...';
        chatMessages.appendChild(aiMsg);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        try {
            const resp = await chrome.runtime.sendMessage({
                target: 'background', type: 'REQUEST_ASK',
                question: text, sessionId: currentSessionId
            });
            if (resp.success) { renderMath(resp.answer, aiMsg); }
            else { aiMsg.textContent = 'Error: ' + resp.error; aiMsg.style.color = 'var(--error)'; }
        } catch (e) { aiMsg.textContent = 'Error: ' + e.message; aiMsg.style.color = 'var(--error)'; }
        finally { chatSendBtn.disabled = false; chatInput.disabled = false; chatInput.focus(); chatMessages.scrollTop = chatMessages.scrollHeight; }
    }

    // ── Standalone Chat ───────────────────────────────
    async function submitChatMessage(text) {
        if (!text.trim()) return;
        const emptyState = standaloneChatMessages.querySelector('.history-empty');
        if (emptyState) emptyState.remove();

        const userMsg = document.createElement('div');
        userMsg.className = 'chat-message user-message';
        userMsg.textContent = text;
        standaloneChatMessages.appendChild(userMsg);
        standaloneChatInput.value = '';
        standaloneChatInput.style.height = 'auto';
        standaloneChatSendBtn.disabled = true;
        standaloneChatInput.disabled = true;

        if (!chatSessionId) {
            try {
                const resp = await chrome.runtime.sendMessage({ target: 'background', type: 'CREATE_CHAT_SESSION', initialText: text });
                chatSessionId = resp.sessionId;
            } catch { /* ignore */ }
        }

        const aiMsg = document.createElement('div');
        aiMsg.className = 'chat-message ai-message';
        aiMsg.textContent = 'Thinking...';
        standaloneChatMessages.appendChild(aiMsg);
        standaloneChatMessages.scrollTop = standaloneChatMessages.scrollHeight;

        try {
            const resp = await chrome.runtime.sendMessage({
                target: 'background', type: 'REQUEST_CHAT',
                question: text, chatSessionId: chatSessionId,
                ocrContext: currentOcrText || '', solutionContext: currentResult || ''
            });
            if (resp.success) { renderMath(resp.answer, aiMsg); }
            else { aiMsg.textContent = 'Error: ' + resp.error; aiMsg.style.color = 'var(--error)'; }
        } catch (e) { aiMsg.textContent = 'Error: ' + e.message; aiMsg.style.color = 'var(--error)'; }
        finally { standaloneChatSendBtn.disabled = false; standaloneChatInput.disabled = false; standaloneChatInput.focus(); standaloneChatMessages.scrollTop = standaloneChatMessages.scrollHeight; }
    }

    // ── History ───────────────────────────────────────
    async function loadHistoryUI() {
        showScreen('history');
        try {
            const sessions = await chrome.runtime.sendMessage({ target: 'background', type: 'GET_SESSIONS' });
            historyList.innerHTML = '';
            if (!sessions || sessions.length === 0) {
                historyList.innerHTML = '<div class="history-empty"><span>No saved problems yet.</span></div>';
                return;
            }
            const now = Date.now();
            sessions.forEach(session => {
                const el = document.createElement('div');
                el.className = 'history-card';
                const diffMin = Math.floor((now - session.timestamp) / 60000);
                const timeStr = diffMin < 1 ? 'Just now' : diffMin < 60 ? `${diffMin}m ago` : diffMin < 1440 ? `${Math.floor(diffMin / 60)}h ago` : `${Math.floor(diffMin / 1440)}d ago`;
                const preview = (session.isChat ? session.ocrText : (session.solution || session.ocrText || '')).replace(/[#$*_]/g, '').trim();
                const icon = session.isChat ? '💬' : '∑';
                const label = session.isChat ? 'AI Chat' : 'Step-by-Step';
                el.innerHTML = `
                    <div class="history-card-icon">${icon}</div>
                    <div class="history-card-body">
                        <span class="history-card-preview">${preview.substring(0, 100)}</span>
                        <div class="history-card-meta"><span>${label}</span><span class="dot"></span><span>${timeStr}</span></div>
                    </div>`;
                el.addEventListener('click', () => loadSession(session));
                historyList.appendChild(el);
            });
        } catch { historyList.innerHTML = '<div class="history-empty"><span>Could not load history.</span></div>'; }
    }

    function loadSession(session) {
        currentSessionId = session.id;
        if (session.isChat) {
            showScreen('chat');
            chatSessionId = session.id;
            standaloneChatMessages.innerHTML = '';
            if (session.messages && session.messages.length > 0) {
                session.messages.forEach(msg => {
                    const bubble = document.createElement('div');
                    bubble.className = `chat-message ${msg.role}-message`;
                    if (msg.role === 'ai') renderMath(msg.text, bubble);
                    else bubble.textContent = msg.text;
                    standaloneChatMessages.appendChild(bubble);
                });
                setTimeout(() => standaloneChatMessages.scrollTop = standaloneChatMessages.scrollHeight, 10);
            }
        } else {
            showScreen('result');
            currentOcrText = session.ocrText;
            resultModeTag.textContent = 'Saved Problem';
            resultStatus.textContent = '';
            showResult(session.solution, session.ocrText);
            chatMessages.innerHTML = '';
            if (session.messages) {
                session.messages.forEach(msg => {
                    const bubble = document.createElement('div');
                    bubble.className = `chat-message ${msg.role}-message`;
                    if (msg.role === 'ai') renderMath(msg.text, bubble);
                    else bubble.textContent = msg.text;
                    chatMessages.appendChild(bubble);
                });
            }
        }
    }

    // ── Settings ──────────────────────────────────────
    async function loadSettingsUI() {
        const data = await chrome.storage.local.get(['mode', 'provider', 'apiKey']);
        toggleDefault.checked = (data.mode !== 'byok');
        byokSection.style.display = (data.mode === 'byok') ? 'flex' : 'none';
        providerSelect.value = data.provider || 'openai';
        apiKeyInput.value = data.apiKey || '';
        settingsStatus.textContent = '';
    }

    function showSettingsStatus(msg, type) {
        settingsStatus.textContent = msg;
        settingsStatus.className = `status ${type}`;
        if (type === 'success') setTimeout(() => { if (settingsStatus.textContent === msg) settingsStatus.textContent = ''; }, 3000);
    }

    toggleDefault.addEventListener('change', () => {
        byokSection.style.display = toggleDefault.checked ? 'none' : 'flex';
        if (toggleDefault.checked) {
            chrome.runtime.sendMessage({ target: 'background', type: 'SAVE_SETTINGS', config: { mode: 'default' } });
            updateRateLimitUI();
            showSettingsStatus('✓ Switched to Free Tier', 'success');
        }
    });

    toggleKeyVis.addEventListener('click', () => { apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password'; });

    saveKeyBtn.addEventListener('click', async () => {
        const mode = toggleDefault.checked ? 'default' : 'byok';
        const provider = providerSelect.value;
        const key = apiKeyInput.value.trim();
        if (mode === 'byok' && !key) { showSettingsStatus('Please enter an API key.', 'error'); return; }
        await chrome.runtime.sendMessage({ target: 'background', type: 'SAVE_SETTINGS', config: { hasOnboarded: true, mode, provider, apiKey: key } });
        showSettingsStatus('✓ Settings saved', 'success');
        updateRateLimitUI();
    });

    testKeyBtn.addEventListener('click', async () => {
        const key = apiKeyInput.value.trim();
        if (!key) { showSettingsStatus('Enter an API key first.', 'error'); return; }
        testKeyBtn.textContent = 'Testing...'; testKeyBtn.disabled = true;
        try {
            const resp = await chrome.runtime.sendMessage({ target: 'background', type: 'TEST_CONNECTION', provider: providerSelect.value, apiKey: key });
            showSettingsStatus(resp.success ? '✅ Connection successful!' : '❌ ' + resp.error, resp.success ? 'success' : 'error');
        } catch (e) { showSettingsStatus('❌ ' + e.message, 'error'); }
        finally { testKeyBtn.textContent = 'Test Connection'; testKeyBtn.disabled = false; }
    });

    // ── Onboarding ────────────────────────────────────
    onboardFreeBtn.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ target: 'background', type: 'SAVE_SETTINGS', config: { hasOnboarded: true, mode: 'default', provider: 'openai', apiKey: '' } });
        showScreen('home'); updateRateLimitUI();
    });

    onboardSaveKeyBtn.addEventListener('click', async () => {
        const key = onboardApiKey.value.trim();
        if (!key) { onboardApiKey.style.borderColor = 'var(--error)'; setTimeout(() => onboardApiKey.style.borderColor = '', 2000); return; }
        await chrome.runtime.sendMessage({ target: 'background', type: 'SAVE_SETTINGS', config: { hasOnboarded: true, mode: 'byok', provider: onboardProvider.value, apiKey: key } });
        showScreen('home'); updateRateLimitUI();
    });

    // ── Mode UI Toggle ────────────────────────────────
    function updateModeUI() {
        if (modeChat.checked) {
            screenshotBtnText.textContent = 'Open Chat';
            screenshotBtnIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';
        } else {
            screenshotBtnText.textContent = 'Take Screenshot';
            screenshotBtnIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>';
        }
    }
    modeSolve.addEventListener('change', updateModeUI);
    modeChat.addEventListener('change', updateModeUI);

    // ── Button Wiring ─────────────────────────────────
    screenshotBtn.addEventListener('click', () => {
        if (modeChat.checked) { showScreen('chat'); standaloneChatInput.focus(); return; }
        chrome.runtime.sendMessage({ target: 'background', type: 'REQUEST_SOLVE', mode: 'solve' });
    });

    screenshotBtn2.addEventListener('click', () => {
        chrome.runtime.sendMessage({ target: 'background', type: 'REQUEST_SOLVE', mode: 'solve' });
    });

    backBtn.addEventListener('click', () => showScreen('home'));
    settingsBtn.addEventListener('click', () => { loadSettingsUI(); showScreen('settings'); });
    settingsBackBtn.addEventListener('click', () => showScreen('home'));
    historyBtn.addEventListener('click', loadHistoryUI);
    historyBackBtn.addEventListener('click', () => showScreen('home'));
    chatBackBtn.addEventListener('click', () => showScreen('home'));

    chatNewBtn.addEventListener('click', () => {
        chatSessionId = null; currentOcrText = ''; currentResult = '';
        standaloneChatMessages.innerHTML = '<div class="history-empty" style="margin:auto;padding:20px;"><span>Ask anything!</span></div>';
        standaloneChatInput.value = ''; standaloneChatInput.focus();
    });

    if (homeUpgradeBtn) homeUpgradeBtn.addEventListener('click', () => window.open('https://buy.stripe.com/', '_blank'));

    copyResultBtn.addEventListener('click', async () => {
        if (!currentResult) return;
        try { await navigator.clipboard.writeText(currentResult); } catch { /* ignore */ }
        const origHTML = copyResultBtn.innerHTML;
        copyResultBtn.classList.add('copied');
        copyResultBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => { copyResultBtn.classList.remove('copied'); copyResultBtn.innerHTML = origHTML; }, 2000);
    });

    chatSendBtn.addEventListener('click', () => askFollowUp(chatInput.value));
    chatInput.addEventListener('keypress', e => { if (e.key === 'Enter') askFollowUp(chatInput.value); });
    quickActionBtns.forEach(btn => btn.addEventListener('click', () => { chatInput.value = btn.textContent; askFollowUp(btn.textContent); }));

    standaloneChatSendBtn.addEventListener('click', () => submitChatMessage(standaloneChatInput.value));
    standaloneChatInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitChatMessage(standaloneChatInput.value); } });
    standaloneChatInput.addEventListener('input', () => { standaloneChatInput.style.height = 'auto'; standaloneChatInput.style.height = standaloneChatInput.scrollHeight + 'px'; });

    if (standaloneChatAttachBtn) {
        standaloneChatAttachBtn.addEventListener('click', () => {
            // Trigger screenshot in chat mode
            chrome.runtime.sendMessage({ target: 'background', type: 'REQUEST_SOLVE', mode: 'chat' });
        });
    }

    // ── Listen for Background State Updates ───────────
    chrome.runtime.onMessage.addListener((msg) => {
        switch (msg.type) {
            case 'SOLVE_STARTED':
                showLoading(msg.mode || 'solve');
                break;
            case 'SOLVE_PROGRESS':
                resultLoadingText.textContent = msg.step === 'ocr' ? 'Extracting text...' : 'Solving problem...';
                break;
            case 'SOLVE_COMPLETE':
                currentSessionId = msg.sessionId;
                resultModeTag.textContent = msg.mode === 'solve' ? 'Step-by-Step' : 'Copy Question';
                showResult(msg.result, msg.ocrText);
                updateRateLimitUI();
                break;
            case 'SOLVE_ERROR':
                if (msg.error === 'rate_limit') {
                    resultLoading.style.display = 'none';
                    resultContent.style.display = 'flex';
                    chatContainer.style.display = 'none';
                    resultRendered.innerHTML = '<div class="limit-reached-cta"><span class="limit-reached-title">Daily Limit Reached</span><span class="limit-reached-desc">You\'ve used all 10 free solves today.</span></div>';
                } else {
                    showError(msg.error);
                }
                break;
            case 'SOLVE_CANCELLED':
                showScreen('home');
                break;
            case 'NAVIGATE_TO':
                if (msg.screen === 'settings') { loadSettingsUI(); }
                showScreen(msg.screen);
                break;
            case 'SETTINGS_UPDATED':
                updateRateLimitUI();
                break;
        }
    });

    // ── Init ──────────────────────────────────────────
    const state = await chrome.storage.local.get(['hasOnboarded']);
    if (!state.hasOnboarded) {
        showScreen('onboarding');
    } else {
        showScreen('home');
    }
    updateRateLimitUI();

    // Check for pending result (from Alt+Shift+S while panel was closed)
    const { pendingResult } = await chrome.storage.session.get('pendingResult');
    if (pendingResult && pendingResult.result) {
        currentSessionId = pendingResult.sessionId;
        resultModeTag.textContent = pendingResult.mode === 'solve' ? 'Step-by-Step' : 'Copy Question';
        showResult(pendingResult.result, pendingResult.ocrText);
        await chrome.storage.session.remove('pendingResult');
    }

    // Check active solve state
    try {
        const resp = await chrome.runtime.sendMessage({ target: 'background', type: 'GET_STATE' });
        if (resp?.activeSolve) {
            const s = resp.activeSolve;
            if (s.status === 'ocr' || s.status === 'solving') showLoading(s.mode);
            else if (s.status === 'done' && s.result) {
                currentSessionId = s.id;
                showResult(s.result, s.ocrText);
            }
        }
    } catch { /* background not ready */ }
});
