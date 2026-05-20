// background.js — Central Orchestrator
// ALL processing pipelines live here. No UI logic.
import { cleanLatex } from './utils.js';
import { API } from './config.js';

// ═══════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════
let creatingOffscreen;
let activeSolve = null; // { id, status, mode }
const MAX_SESSIONS = 20;

function generateId() {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// ═══════════════════════════════════════════════════════════
// Broadcast — safely send to all extension pages
// ═══════════════════════════════════════════════════════════
function broadcast(message) {
    chrome.runtime.sendMessage(message).catch(() => {});
}

// ═══════════════════════════════════════════════════════════
// Offscreen Document
// ═══════════════════════════════════════════════════════════
async function ensureOffscreenDocument() {
    if (await chrome.offscreen.hasDocument()) return;
    if (creatingOffscreen) {
        await creatingOffscreen;
    } else {
        creatingOffscreen = chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['CLIPBOARD'],
            justification: 'Clipboard read/write for OCR'
        });
        await creatingOffscreen;
        creatingOffscreen = null;
    }
}

// ═══════════════════════════════════════════════════════════
// Provider Config
// ═══════════════════════════════════════════════════════════
async function getProviderConfig() {
    const data = await chrome.storage.local.get(['mode', 'provider', 'apiKey']);
    if (data.mode === 'byok' && data.apiKey) {
        return { provider: data.provider || 'openai', apiKey: data.apiKey };
    }
    return { provider: 'github', apiKey: undefined };
}

// ═══════════════════════════════════════════════════════════
// Rate Limiting
// ═══════════════════════════════════════════════════════════
function getLocalDateString() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

async function getRateLimit() {
    const data = await chrome.storage.local.get(['dailyCount', 'lastReset']);
    const today = getLocalDateString();
    if (data.lastReset !== today) {
        await chrome.storage.local.set({ dailyCount: 0, lastReset: today });
        return 0;
    }
    return data.dailyCount || 0;
}

async function incrementRateLimit() {
    const count = await getRateLimit();
    const today = getLocalDateString();
    await chrome.storage.local.set({ dailyCount: count + 1, lastReset: today });
    return count + 1;
}

// ═══════════════════════════════════════════════════════════
// Session Storage (chrome.storage.local)
// ═══════════════════════════════════════════════════════════
async function getSessions() {
    const data = await chrome.storage.local.get(['sessions']);
    return data.sessions || [];
}

async function saveSessions(sessions) {
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
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx !== -1) {
        updaterFn(sessions[idx]);
        await saveSessions(sessions);
    }
}

// ═══════════════════════════════════════════════════════════
// Clipboard (via offscreen)
// ═══════════════════════════════════════════════════════════
async function writeClipboard(text) {
    try {
        await ensureOffscreenDocument();
        await chrome.runtime.sendMessage({
            target: 'offscreen', type: 'WRITE_CLIPBOARD', text
        });
    } catch (e) {
        // Fallback: try server-based clipboard
        try {
            await fetch(API.CLIPBOARD, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
        } catch { /* silent fail */ }
    }
}

async function readClipboardImage() {
    await ensureOffscreenDocument();
    await new Promise(r => setTimeout(r, 300));
    const resp = await chrome.runtime.sendMessage({
        target: 'offscreen', type: 'READ_CLIPBOARD'
    });
    if (resp?.error) throw new Error(resp.error);
    return resp.base64;
}

// ═══════════════════════════════════════════════════════════
// Fetch Helpers
// ═══════════════════════════════════════════════════════════
async function fetchOcr(base64Image, provider, apiKey) {
    const resp = await fetch(API.OCR, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image, provider, apiKey })
    });
    if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `OCR server error ${resp.status}`);
    }
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return data.ParsedResults?.[0]?.ParsedText || '';
}

async function fetchSolve(question, base64Image, provider, apiKey) {
    const body = { question, provider, apiKey };
    if (base64Image) body.image = base64Image;
    const resp = await fetch(API.SOLVE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `Solve server error ${resp.status}`);
    }
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return data.solution || data.text || '';
}

async function fetchAsk(question, ocrText, solutionText, provider, apiKey) {
    const resp = await fetch(API.ASK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, ocrText, solutionText, provider, apiKey })
    });
    if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `Ask server error ${resp.status}`);
    }
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return data.answer || '';
}

// ═══════════════════════════════════════════════════════════
// Solve Pipeline — THE core function
// ═══════════════════════════════════════════════════════════
async function startSolve(mode, base64Image) {
    // ── Queue Protection ──
    if (activeSolve && (activeSolve.status === 'ocr' || activeSolve.status === 'solving')) {
        broadcast({ type: 'SOLVE_ERROR', error: 'A solve is already in progress. Please wait.' });
        return;
    }

    const sessionId = generateId();
    activeSolve = { id: sessionId, status: 'starting', mode };

    // Broadcast start
    broadcast({ type: 'SOLVE_STARTED', sessionId, mode });
    chrome.notifications.create('solve_status', {
        type: 'basic', iconUrl: 'icon.png',
        title: 'SnapSolve',
        message: mode === 'solve' ? 'Solving problem...' : 'Extracting math...'
    });

    const { provider, apiKey } = await getProviderConfig();

    // Rate limit check (default mode, solve only)
    if (mode === 'solve') {
        const config = await chrome.storage.local.get(['mode']);
        if (config.mode !== 'byok') {
            const count = await getRateLimit();
            if (count >= 10) {
                activeSolve = { id: sessionId, status: 'error', mode, error: 'rate_limit' };
                broadcast({ type: 'SOLVE_ERROR', error: 'rate_limit', sessionId });
                return;
            }
        }
    }

    try {
        // ── Step 1: OCR ──
        activeSolve.status = 'ocr';
        broadcast({ type: 'SOLVE_PROGRESS', step: 'ocr', sessionId });

        const extracted = await fetchOcr(base64Image, provider, apiKey);
        if (!extracted.trim()) throw new Error('No text found in the screenshot.');

        let resultText = '';

        if (mode === 'solve') {
            // ── Step 2: Solve ──
            activeSolve.status = 'solving';
            broadcast({ type: 'SOLVE_PROGRESS', step: 'solve', sessionId });

            resultText = await fetchSolve(extracted, base64Image, provider, apiKey);

            // Increment rate limit on success (default mode)
            const config = await chrome.storage.local.get(['mode']);
            if (config.mode !== 'byok') {
                await incrementRateLimit();
            }
        } else {
            resultText = cleanLatex(extracted);
        }

        // ── Step 3: Save Session ──
        // Strip image data from session to save storage (keep first 200 chars as thumbnail marker)
        await addSession({
            id: sessionId,
            timestamp: Date.now(),
            ocrText: extracted,
            solution: resultText,
            mode: mode,
            isChat: false,
            messages: []
        });

        // ── Step 4: Write clipboard ──
        await writeClipboard(resultText);

        // ── Step 5: Update state ──
        activeSolve = { id: sessionId, status: 'done', mode, result: resultText, ocrText: extracted };
        await chrome.storage.session.set({
            activeSolve,
            pendingResult: { sessionId, result: resultText, ocrText: extracted, mode }
        });

        // ── Step 6: Broadcast ──
        broadcast({ type: 'SOLVE_COMPLETE', sessionId, result: resultText, ocrText: extracted, mode });

        chrome.notifications.create('solve_status', {
            type: 'basic', iconUrl: 'icon.png',
            title: 'SnapSolve', message: '✓ Solution copied to clipboard!'
        });

    } catch (error) {
        console.error('[Background] Solve error:', error);
        const errMsg = error.message === 'Failed to fetch'
            ? 'Cannot connect to server. Is the server running?'
            : error.message;

        activeSolve = { id: sessionId, status: 'error', mode, error: errMsg };
        await chrome.storage.session.set({ activeSolve });

        broadcast({ type: 'SOLVE_ERROR', error: errMsg, sessionId });
        chrome.notifications.create('solve_status', {
            type: 'basic', iconUrl: 'icon.png',
            title: 'SnapSolve', message: errMsg
        });
    }
}

// ═══════════════════════════════════════════════════════════
// Ask Pipeline (follow-up chat)
// ═══════════════════════════════════════════════════════════
async function handleAsk(question, sessionId) {
    const { provider, apiKey } = await getProviderConfig();

    // Load session context
    const sessions = await getSessions();
    const session = sessions.find(s => s.id === sessionId);
    const ocrText = session?.ocrText || '';
    const solutionText = session?.solution || '';

    try {
        const answer = await fetchAsk(question, ocrText, solutionText, provider, apiKey);

        // Save messages to session
        if (sessionId) {
            await updateSession(sessionId, s => {
                if (!s.messages) s.messages = [];
                s.messages.push({ role: 'user', text: question });
                s.messages.push({ role: 'ai', text: answer });
            });
        }

        return { success: true, answer };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ═══════════════════════════════════════════════════════════
// Standalone Chat (no session context)
// ═══════════════════════════════════════════════════════════
async function handleChat(question, chatSessionId, ocrContext, solutionContext) {
    const { provider, apiKey } = await getProviderConfig();

    try {
        const answer = await fetchAsk(question, ocrContext || '', solutionContext || '', provider, apiKey);

        // Save to chat session
        if (chatSessionId) {
            await updateSession(chatSessionId, s => {
                if (!s.messages) s.messages = [];
                s.messages.push({ role: 'user', text: question });
                s.messages.push({ role: 'ai', text: answer });
            });
        }

        return { success: true, answer };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ═══════════════════════════════════════════════════════════
// Screenshot Capture (browser-native)
// ═══════════════════════════════════════════════════════════
async function captureScreenshot() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('No active tab found.');

    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
        throw new Error('Cannot capture browser system pages. Navigate to a regular website.');
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    if (!dataUrl) throw new Error('Failed to capture tab image.');

    // Inject screenshot data, then inject crop overlay
    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (screenshot) => { window.__snapsolve_screenshot = screenshot; },
        args: [dataUrl]
    });
    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['crop-overlay.js']
    });
    // crop-overlay.js will send CROPPED_SCREENSHOT back
}

// ═══════════════════════════════════════════════════════════
// Snip via Local Server (Windows snipping tool)
// ═══════════════════════════════════════════════════════════
async function snipAndSolve(mode) {
    if (activeSolve && (activeSolve.status === 'ocr' || activeSolve.status === 'solving')) {
        broadcast({ type: 'SOLVE_ERROR', error: 'A solve is already in progress.' });
        return;
    }

    broadcast({ type: 'SOLVE_STARTED', sessionId: null, mode });

    try {
        const snipResp = await fetch(API.SNIP, {
            method: 'POST',
            signal: AbortSignal.timeout(35000)
        });

        if (!snipResp.ok) throw new Error(`Snip server error ${snipResp.status}`);
        const snipData = await snipResp.json();
        if (snipData.error) throw new Error(snipData.error);

        await startSolve(mode, snipData.image);
    } catch (e) {
        if (e.name === 'TimeoutError' || e.message.includes('timed out') || e.message.includes('cancelled')) {
            activeSolve = null;
            broadcast({ type: 'SOLVE_CANCELLED' });
            return;
        }

        // Snip server unavailable — try browser-native capture
        if (e.message === 'Failed to fetch' || e.message.includes('server error')) {
            console.log('[Background] Snip server unavailable, trying browser capture...');
            try {
                await captureScreenshot();
                // Result comes back via CROPPED_SCREENSHOT message
            } catch (capErr) {
                broadcast({ type: 'SOLVE_ERROR', error: capErr.message });
            }
            return;
        }

        broadcast({ type: 'SOLVE_ERROR', error: e.message });
    }
}

// ═══════════════════════════════════════════════════════════
// Process Clipboard Image
// ═══════════════════════════════════════════════════════════
async function processClipboard(mode) {
    try {
        const base64 = await readClipboardImage();
        await startSolve(mode, base64);
    } catch (error) {
        broadcast({ type: 'SOLVE_ERROR', error: error.message });
        chrome.notifications.create('solve_status', {
            type: 'basic', iconUrl: 'icon.png',
            title: 'SnapSolve', message: error.message
        });
    }
}

// ═══════════════════════════════════════════════════════════
// Test Connection
// ═══════════════════════════════════════════════════════════
async function testConnection(provider, apiKey) {
    try {
        const resp = await fetch(API.SOLVE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: 'What is 2+2? Answer with just the number.',
                provider, apiKey
            }),
            signal: AbortSignal.timeout(15000)
        });
        const data = await resp.json();
        if (data.error) return { success: false, error: data.error };
        if (data.solution && data.solution.includes('4')) {
            return { success: true };
        }
        return { success: false, error: 'Got a response but it seems unusual.' };
    } catch (e) {
        const msg = e.message === 'Failed to fetch'
            ? 'Cannot connect to server.'
            : e.message;
        return { success: false, error: msg };
    }
}

// ═══════════════════════════════════════════════════════════
// Keyboard Shortcut Commands
// ═══════════════════════════════════════════════════════════
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'take_screenshot') {
        await snipAndSolve('solve');
    }
    if (command === 'process_clipboard') {
        await processClipboard('solve');
    }
});

// ═══════════════════════════════════════════════════════════
// Message Router
// ═══════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Let offscreen messages through to offscreen handler
    if (message.target === 'offscreen') return;

    // Handle cropped screenshot from content script (crop-overlay.js)
    if (message.target === 'background' && message.type === 'CROPPED_SCREENSHOT') {
        startSolve('solve', message.image);
        return;
    }

    // Handle new clipboard image from offscreen (watch mode)
    if (message.target === 'background' && message.type === 'NEW_CLIPBOARD_IMAGE') {
        // Only process if armed
        chrome.storage.session.get('isArmedSession').then(({ isArmedSession }) => {
            if (!isArmedSession) return;
            chrome.storage.session.set({ isArmedSession: false });
            chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP_POLLING' });
            startSolve('solve', message.base64);
        });
        return;
    }

    // Skip messages not for background
    if (message.target && message.target !== 'background') return;

    switch (message.type) {
        // ── From Popup ──
        case 'START_SOLVE':
            snipAndSolve(message.mode || 'solve');
            sendResponse({ success: true });
            break;

        case 'START_CLIPBOARD_SOLVE':
            processClipboard(message.mode || 'solve');
            sendResponse({ success: true });
            break;

        case 'TAKE_SCREENSHOT':
            captureScreenshot().catch(e => {
                broadcast({ type: 'SOLVE_ERROR', error: e.message });
            });
            sendResponse({ success: true });
            break;

        // ── From Side Panel ──
        case 'REQUEST_SOLVE':
            snipAndSolve(message.mode || 'solve');
            sendResponse({ success: true });
            break;

        case 'REQUEST_SCREENSHOT':
            captureScreenshot().catch(e => {
                broadcast({ type: 'SOLVE_ERROR', error: e.message });
            });
            sendResponse({ success: true });
            break;

        case 'REQUEST_ASK':
            handleAsk(message.question, message.sessionId)
                .then(r => sendResponse(r));
            return true; // async

        case 'REQUEST_CHAT':
            handleChat(message.question, message.chatSessionId, message.ocrContext, message.solutionContext)
                .then(r => sendResponse(r));
            return true; // async

        case 'CREATE_CHAT_SESSION': {
            const chatSession = {
                id: generateId(),
                timestamp: Date.now(),
                ocrText: message.initialText || '',
                solution: '',
                isChat: true,
                messages: []
            };
            addSession(chatSession).then(() => sendResponse({ sessionId: chatSession.id }));
            return true;
        }

        // ── Settings ──
        case 'SAVE_SETTINGS':
            chrome.storage.local.set(message.config).then(() => {
                sendResponse({ success: true });
                broadcast({ type: 'SETTINGS_UPDATED' });
            });
            return true;

        case 'TEST_CONNECTION':
            testConnection(message.provider, message.apiKey)
                .then(r => sendResponse(r));
            return true;

        // ── State Queries ──
        case 'GET_STATE':
            sendResponse({ activeSolve });
            break;

        case 'GET_SESSIONS':
            getSessions().then(s => sendResponse(s));
            return true;

        case 'GET_RATE_LIMIT':
            getRateLimit().then(count => sendResponse({ count, limit: 10 }));
            return true;

        // ── Clipboard Polling (watch mode) ──
        case 'ARM_ONCE':
            chrome.storage.session.set({ isArmedSession: true });
            ensureOffscreenDocument().then(async () => {
                await new Promise(r => setTimeout(r, 300));
                chrome.runtime.sendMessage({ target: 'offscreen', type: 'START_POLLING' });
            });
            sendResponse({ success: true });
            break;

        case 'DISARM':
            chrome.storage.session.set({ isArmedSession: false });
            chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP_POLLING' }).catch(() => {});
            sendResponse({ success: true });
            break;

        case 'START_POLLING':
            chrome.storage.session.set({ isWatching: true });
            ensureOffscreenDocument().then(async () => {
                await new Promise(r => setTimeout(r, 500));
                chrome.runtime.sendMessage({ target: 'offscreen', type: 'START_POLLING' });
                chrome.alarms.create('watchmode-keepalive', { periodInMinutes: 0.4 });
            });
            sendResponse({ success: true });
            break;

        case 'STOP_POLLING':
            chrome.storage.session.set({ isWatching: false });
            chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP_POLLING' }).catch(() => {});
            chrome.alarms.clear('watchmode-keepalive');
            sendResponse({ success: true });
            break;
    }
});

// ═══════════════════════════════════════════════════════════
// Keepalive Alarm
// ═══════════════════════════════════════════════════════════
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'watchmode-keepalive') { /* heartbeat */ }
});

// ═══════════════════════════════════════════════════════════
// Restore State on Service Worker Startup
// ═══════════════════════════════════════════════════════════
async function restoreState() {
    console.log('[Background] Service worker started, restoring state...');

    // Restore watch mode
    const { isWatching } = await chrome.storage.session.get('isWatching');
    if (isWatching) {
        await ensureOffscreenDocument();
        await new Promise(r => setTimeout(r, 500));
        chrome.runtime.sendMessage({ target: 'offscreen', type: 'START_POLLING' }).catch(() => {});
        chrome.alarms.create('watchmode-keepalive', { periodInMinutes: 0.4 });
    }

    // Restore activeSolve from session storage
    const { activeSolve: stored } = await chrome.storage.session.get('activeSolve');
    if (stored) {
        // If it was mid-solve when SW died, mark as error
        if (stored.status === 'ocr' || stored.status === 'solving') {
            stored.status = 'error';
            stored.error = 'Solve interrupted. Please try again.';
            await chrome.storage.session.set({ activeSolve: stored });
        }
        activeSolve = stored;
    }
}
restoreState();
