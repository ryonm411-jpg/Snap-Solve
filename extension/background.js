import { cleanLatex } from './utils.js';

let creatingOffscreen;
let isArmed = false; // One-shot arm mode

// ── Restore Watch Mode on Service Worker Startup ─────────
async function restoreWatchMode() {
    console.log('[Background] restoreWatchMode() running...');
    const { isWatching } = await chrome.storage.session.get('isWatching');
    if (isWatching) {
        console.log('[Background] Watch mode was left ON. Restoring...');
        await ensureOffscreenDocument();
        await new Promise(resolve => setTimeout(resolve, 500));
        chrome.runtime.sendMessage({ target: 'offscreen', type: 'START_POLLING' });
        chrome.alarms.create('watchmode-keepalive', { periodInMinutes: 0.4 });
    }
}
restoreWatchMode();

// ── Ensure Offscreen Document Exists ─────────────────────
async function ensureOffscreenDocument() {
    if (await chrome.offscreen.hasDocument()) return;
    if (creatingOffscreen) {
        await creatingOffscreen;
    } else {
        creatingOffscreen = chrome.offscreen.createDocument({
            url: "offscreen.html",
            reasons: ["CLIPBOARD"],
            justification: "Clipboard polling for image OCR"
        });
        await creatingOffscreen;
        creatingOffscreen = null;
    }
}

chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'take_screenshot') {
        // Open the popup so it has focus, then tell it to start the snip
        try {
            await chrome.action.openPopup();
            // Small delay for popup DOM to load, then trigger the snip
            setTimeout(() => {
                chrome.runtime.sendMessage({ type: 'TRIGGER_SNIP' });
            }, 300);
        } catch (e) {
            // openPopup() may fail if already open or no active window — ignore
            chrome.runtime.sendMessage({ type: 'TRIGGER_SNIP' });
        }
    }

    if (command === 'process_clipboard') {
        const { pendingMode } = await chrome.storage.session.get('pendingMode');
        await runOcrFromClipboard(pendingMode || 'copy');
    }
});

// ── Arm for one-shot clipboard capture ───────────────────
async function armForOneShot() {
    isArmed = true;
    await chrome.storage.session.set({ popupState: 'armed' });
    await ensureOffscreenDocument();
    await new Promise(resolve => setTimeout(resolve, 300));
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'START_POLLING' });
    console.log('[Background] Armed for one-shot clipboard capture');
}

// ── Message handler ───────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'background') return;

    // ── Arm / Disarm from popup
    if (message.type === 'ARM_ONCE') {
        armForOneShot().then(() => sendResponse({ success: true }));
        return true;
    }

    if (message.type === 'DISARM') {
        isArmed = false;
        chrome.storage.session.set({ popupState: 'home' });
        chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP_POLLING' });
        sendResponse({ success: true });
        return;
    }

    // ── Watch Mode toggle from popup
    if (message.type === 'START_POLLING') {
        console.log('[Background] Received START_POLLING from popup');
        chrome.storage.session.set({ isWatching: true });
        ensureOffscreenDocument().then(async () => {
            await new Promise(resolve => setTimeout(resolve, 500));
            chrome.runtime.sendMessage({ target: 'offscreen', type: 'START_POLLING' });
            chrome.alarms.create('watchmode-keepalive', { periodInMinutes: 0.4 });
        });
        sendResponse({ success: true });

    } else if (message.type === 'STOP_POLLING') {
        console.log('[Background] Received STOP_POLLING from popup');
        chrome.storage.session.set({ isWatching: false });
        chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP_POLLING' });
        chrome.alarms.clear('watchmode-keepalive');
        sendResponse({ success: true });
    }
});

// ── Config helper ─────────────────────────────────────────
async function getProviderConfig() {
    const data = await chrome.storage.local.get(['mode', 'provider', 'apiKey']);
    if (data.mode === 'byok' && data.apiKey) {
        return { provider: data.provider || 'openai', apiKey: data.apiKey };
    }
    return { provider: 'github', apiKey: undefined };
}

// ── New clipboard image detected by offscreen ─────────────
chrome.runtime.onMessage.addListener(async (message) => {
    if (message.target !== 'background' || message.type !== 'NEW_CLIPBOARD_IMAGE') return;
    if (!isArmed) return; // Ignore if not armed

    isArmed = false; // One-shot: disarm immediately
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP_POLLING' });

    const { pendingMode } = await chrome.storage.session.get('pendingMode');
    const mode = pendingMode || 'copy';
    const { provider, apiKey } = await getProviderConfig();

    // Tell popup we're loading
    chrome.runtime.sendMessage({ type: 'OCR_LOADING', mode });
    chrome.storage.session.set({ popupState: 'result' });

    chrome.notifications.create('ocr_status', {
        type: 'basic',
        iconUrl: 'icon.png',
        title: 'SnapSolve',
        message: mode === 'solve' ? 'Solving problem...' : 'Extracting math...'
    });

    try {
        const extracted = await fetchOcr(message.base64, provider, apiKey);
        let resultText = '';

        if (mode === 'solve') {
            resultText = await fetchSolve(extracted, message.base64, provider, apiKey);
        } else {
            resultText = extracted;
        }

        // Write to clipboard via offscreen
        await chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'WRITE_CLIPBOARD',
            text: resultText
        });

        // Cache result so popup can display it if re-opened
        await chrome.storage.session.set({ lastResult: resultText });

        // Push result to popup if it's open
        chrome.runtime.sendMessage({ type: 'OCR_RESULT', text: resultText, ocrText: extracted });

        chrome.notifications.create('ocr_status', {
            type: 'basic',
            iconUrl: 'icon.png',
            title: 'SnapSolve',
            message: '✓ Copied to clipboard!'
        });

    } catch (error) {
        console.error('[Background] OCR Error:', error);
        chrome.storage.session.set({ popupState: 'home' });
        chrome.runtime.sendMessage({ type: 'OCR_ERROR', error: error.message });
        chrome.notifications.create('ocr_status', {
            type: 'basic',
            iconUrl: 'icon.png',
            title: 'SnapSolve',
            message: error.message
        });
    }
});

// ── Direct clipboard read pipeline (for Ctrl+Shift+V) ────
async function runOcrFromClipboard(mode) {
    try {
        await ensureOffscreenDocument();
        const readResponse = await chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'READ_CLIPBOARD'
        });
        if (readResponse?.error) throw new Error(readResponse.error);

        const { provider, apiKey } = await getProviderConfig();
        const extracted = await fetchOcr(readResponse.base64, provider, apiKey);
        const resultText = mode === 'solve' ? await fetchSolve(extracted, readResponse.base64, provider, apiKey) : extracted;

        await chrome.runtime.sendMessage({
            target: 'offscreen', type: 'WRITE_CLIPBOARD', text: resultText
        });

        chrome.notifications.create('ocr_status', {
            type: 'basic', iconUrl: 'icon.png',
            title: 'SnapSolve', message: '✓ Copied to clipboard!'
        });
    } catch (error) {
        chrome.notifications.create('ocr_status', {
            type: 'basic', iconUrl: 'icon.png',
            title: 'SnapSolve', message: error.message
        });
    }
}

// ── Fetch helpers ─────────────────────────────────────────
async function fetchOcr(base64Image, provider, apiKey) {
    const resp = await fetch('http://localhost:3000/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image, provider, apiKey })
    });
    if (!resp.ok) throw new Error(`Server error ${resp.status}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return data.ParsedResults?.[0]?.ParsedText || '';
}

async function fetchSolve(question, base64Image, provider, apiKey) {
    const resp = await fetch('http://localhost:3000/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, image: base64Image, provider, apiKey })
    });
    if (!resp.ok) throw new Error(`Server error ${resp.status}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return data.solution || data.text || '';
}

// ── Keepalive alarm ───────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'watchmode-keepalive') { /* heartbeat */ }
});
