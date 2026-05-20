// crop-overlay.js — Injected by background.js into the active tab
// Shows a full-screen overlay with the captured screenshot and lets the user
// draw a rectangle to crop. Sends the cropped base64 image back via message.

(function () {
    // Prevent double-injection
    if (document.getElementById('snapsolve-crop-overlay')) return;

    // The screenshot dataUrl is passed via window.__snapsolve_screenshot
    const screenshotUrl = window.__snapsolve_screenshot;
    if (!screenshotUrl) return;

    // ── Create overlay elements ──────────────────────────────────
    const overlay = document.createElement('div');
    overlay.id = 'snapsolve-crop-overlay';
    Object.assign(overlay.style, {
        position: 'fixed',
        top: '0', left: '0',
        width: '100vw', height: '100vh',
        zIndex: '2147483647',
        cursor: 'crosshair',
        margin: '0', padding: '0',
        background: 'transparent',
    });

    // Dim layer (darkens everything except the selection)
    const dimLayer = document.createElement('canvas');
    dimLayer.id = 'snapsolve-dim-canvas';
    Object.assign(dimLayer.style, {
        position: 'absolute',
        top: '0', left: '0',
        width: '100%', height: '100%',
        pointerEvents: 'none',
    });

    // Instruction tooltip
    const tooltip = document.createElement('div');
    Object.assign(tooltip.style, {
        position: 'absolute',
        top: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.75)',
        color: '#fff',
        padding: '8px 20px',
        borderRadius: '8px',
        fontSize: '14px',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: '500',
        pointerEvents: 'none',
        zIndex: '2147483647',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    });
    tooltip.textContent = 'Draw a rectangle around the problem — press Esc to cancel';

    overlay.appendChild(dimLayer);
    overlay.appendChild(tooltip);
    document.body.appendChild(overlay);

    // ── Set canvas size to match viewport ─────────────────────────
    const W = window.innerWidth;
    const H = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    dimLayer.width = W * dpr;
    dimLayer.height = H * dpr;
    const ctx = dimLayer.getContext('2d');
    ctx.scale(dpr, dpr);

    // Initial dim
    drawDim(null);

    // ── Drawing state ────────────────────────────────────────────
    let isDrawing = false;
    let startX = 0, startY = 0;
    let rect = null;

    function drawDim(sel) {
        ctx.clearRect(0, 0, W, H);
        // Semi-transparent dark overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(0, 0, W, H);

        if (sel) {
            // Cut out the selected area (make it clear)
            ctx.clearRect(sel.x, sel.y, sel.w, sel.h);

            // Draw border around selection
            ctx.strokeStyle = '#4f46e5';
            ctx.lineWidth = 2;
            ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);

            // Draw size label
            const label = `${Math.round(sel.w)} × ${Math.round(sel.h)}`;
            ctx.font = '12px Inter, system-ui, sans-serif';
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            const textW = ctx.measureText(label).width + 12;
            const labelX = sel.x;
            const labelY = sel.y + sel.h + 4;
            ctx.fillRect(labelX, labelY, textW, 20);
            ctx.fillStyle = '#fff';
            ctx.fillText(label, labelX + 6, labelY + 14);
        }
    }

    // ── Mouse handlers ───────────────────────────────────────────
    overlay.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        isDrawing = true;
        startX = e.clientX;
        startY = e.clientY;
        rect = null;
    });

    overlay.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;
        const x = Math.min(startX, e.clientX);
        const y = Math.min(startY, e.clientY);
        const w = Math.abs(e.clientX - startX);
        const h = Math.abs(e.clientY - startY);
        rect = { x, y, w, h };
        drawDim(rect);
    });

    overlay.addEventListener('mouseup', (e) => {
        if (!isDrawing) return;
        isDrawing = false;

        if (!rect || rect.w < 10 || rect.h < 10) {
            // Too small — ignore
            rect = null;
            drawDim(null);
            return;
        }

        // Crop the screenshot to the selected rectangle
        cropAndSend(rect);
    });

    // ── Escape to cancel ─────────────────────────────────────────
    function onKeyDown(e) {
        if (e.key === 'Escape') {
            cleanup();
        }
    }
    document.addEventListener('keydown', onKeyDown, true);

    // ── Crop logic ───────────────────────────────────────────────
    function cropAndSend(sel) {
        const img = new Image();
        img.onload = () => {
            // Scale selection coordinates to image coordinates
            // (the screenshot may be at device pixel ratio)
            const scaleX = img.width / W;
            const scaleY = img.height / H;

            const cropCanvas = document.createElement('canvas');
            const cw = Math.round(sel.w * scaleX);
            const ch = Math.round(sel.h * scaleY);
            cropCanvas.width = cw;
            cropCanvas.height = ch;

            const cctx = cropCanvas.getContext('2d');
            cctx.drawImage(
                img,
                Math.round(sel.x * scaleX), Math.round(sel.y * scaleY), cw, ch,
                0, 0, cw, ch
            );

            const croppedDataUrl = cropCanvas.toDataURL('image/png');

            // Send back to background.js
            chrome.runtime.sendMessage({
                target: 'background',
                type: 'CROPPED_SCREENSHOT',
                image: croppedDataUrl
            });

            cleanup();
        };
        img.src = screenshotUrl;
    }

    // ── Cleanup ──────────────────────────────────────────────────
    function cleanup() {
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        delete window.__snapsolve_screenshot;
    }
})();
