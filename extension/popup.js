// popup.js — Lightweight launcher only
// No OCR, no solve, no result rendering. Just sends messages.

document.addEventListener('DOMContentLoaded', async () => {
    const workspaceBtn = document.getElementById('workspace-btn');
    const pasteBtn     = document.getElementById('paste-btn');
    const settingsBtn  = document.getElementById('settings-btn');
    const statusDot    = document.getElementById('status-dot');

    // ── Status indicator ──
    async function updateStatus() {
        try {
            const resp = await chrome.runtime.sendMessage({ target: 'background', type: 'GET_STATE' });
            if (resp?.activeSolve) {
                const s = resp.activeSolve.status;
                statusDot.className = 'status-dot ' +
                    (s === 'ocr' || s === 'solving' ? 'active' :
                     s === 'done' ? 'done' :
                     s === 'error' ? 'error' : '');
                statusDot.title =
                    s === 'ocr' ? 'Extracting text...' :
                    s === 'solving' ? 'Solving...' :
                    s === 'done' ? 'Solution ready' :
                    s === 'error' ? 'Error' : 'Idle';
            }
        } catch { /* background not ready */ }
    }
    updateStatus();

    // Listen for state changes while popup is open
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'SOLVE_STARTED' || msg.type === 'SOLVE_PROGRESS' ||
            msg.type === 'SOLVE_COMPLETE' || msg.type === 'SOLVE_ERROR') {
            updateStatus();
        }
    });

    // ── Open Workspace (Side Panel) ──
    workspaceBtn.addEventListener('click', async () => {
        try {
            const win = await chrome.windows.getCurrent();
            await chrome.sidePanel.open({ windowId: win.id });
            window.close();
        } catch (e) {
            console.error('Failed to open side panel:', e);
        }
    });

    // ── Paste & Solve ──
    pasteBtn.addEventListener('click', async () => {
        try {
            const win = await chrome.windows.getCurrent();
            // Open side panel first so user sees the result
            chrome.sidePanel.open({ windowId: win.id }).catch(() => {});
        } catch { /* ignore */ }

        // Tell background to start solving
        chrome.runtime.sendMessage({ target: 'background', type: 'START_SOLVE', mode: 'solve' });
        window.close();
    });

    // ── Settings ──
    settingsBtn.addEventListener('click', async () => {
        try {
            const win = await chrome.windows.getCurrent();
            await chrome.sidePanel.open({ windowId: win.id });
            // Give panel a moment to load
            setTimeout(() => {
                chrome.runtime.sendMessage({ type: 'NAVIGATE_TO', screen: 'settings' });
                window.close();
            }, 300);
        } catch (e) {
            console.error('Failed to open side panel:', e);
        }
    });
});
