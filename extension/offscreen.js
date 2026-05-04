let watchMode = false;
let pollingInterval = null;
let lastImageHash = null;
let isReading = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'offscreen') {
        if (message.type === 'READ_CLIPBOARD') {
            readClipboardImage().then(sendResponse).catch(err => sendResponse({ error: err.message }));
            return true; // Keep channel open
        } else if (message.type === 'WRITE_CLIPBOARD') {
            // Use modern API - offscreen documents are allowed to WRITE without focus!
            navigator.clipboard.writeText(message.text)
                .then(() => sendResponse({ success: true }))
                .catch(err => sendResponse({ error: err.message }));
            return true; // Keep channel open
        } else if (message.type === 'START_POLLING') {
            startPolling();
            sendResponse({ success: true });
        } else if (message.type === 'STOP_POLLING') {
            stopPolling();
            sendResponse({ success: true });
        }
    }
});

function startPolling() {
    console.log('[Offscreen] Received START_POLLING command. Setting watchMode = true');
    watchMode = true;
    pollClipboard(); // Do an immediate check
}

function stopPolling() {
    console.log('[Offscreen] Received STOP_POLLING command. Setting watchMode = false');
    watchMode = false;
}

// Polling interval set to 1200ms for better responsiveness
pollingInterval = setInterval(pollClipboard, 1200);

async function pollClipboard() {
    // Only block if not watching or already reading
    if (!watchMode || isReading) return;
    
    isReading = true;
    try {
        window.focus(); // Required hack for Chrome offscreen clipboard read access
        const clipboardItems = await navigator.clipboard.read();
        
        let foundImage = false;
        let imageBlob = null;
        
        for (const item of clipboardItems) {
            const imageTypes = item.types.filter(type => type.startsWith('image/'));
            if (imageTypes.length > 0) {
                foundImage = true;
                imageBlob = await item.getType(imageTypes[0]);
                break;
            }
        }
        
        if (foundImage && imageBlob) {
            const currentHash = await hashBlob(imageBlob);
            
            if (currentHash !== lastImageHash) {
                console.log('[Offscreen] New clipboard image detected! Hash:', currentHash);
                lastImageHash = currentHash;
                const compressed = await compressImage(imageBlob);
                
                chrome.runtime.sendMessage({
                    target: 'background',
                    type: 'NEW_CLIPBOARD_IMAGE',
                    base64: compressed.base64
                });
            } else {
                console.log('[Offscreen] Skipping duplicate image (hash matches).');
            }
        } else {
            // Reset hash if no image is found (e.g. text was copied) to prevent infinite loops
            lastImageHash = null;
        }
    } catch (error) {
        // Ignore read errors but log them for debugging
        console.error('[Offscreen] Clipboard read error:', error.message || error);
    } finally {
        isReading = false;
    }
}

async function hashBlob(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function readClipboardImage() {
    window.focus(); // Required hack for Chrome offscreen clipboard read access
    const clipboardItems = await navigator.clipboard.read();
    let imageBlob = null;
    
    for (const item of clipboardItems) {
        const imageTypes = item.types.filter(type => type.startsWith('image/'));
        if (imageTypes.length > 0) {
            imageBlob = await item.getType(imageTypes[0]);
            break;
        }
    }
    
    if (!imageBlob) {
        throw new Error('No image found in clipboard.');
    }

    return await compressImage(imageBlob);
}

function compressImage(blob) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            
            const MAX_WIDTH = 1200;
            const MAX_HEIGHT = 1200;
            
            if (width > height) {
                if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
            } else {
                if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
            }
            
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            
            const base64String = canvas.toDataURL('image/jpeg', 0.8);
            URL.revokeObjectURL(url);
            resolve({ base64: base64String });
        };
        img.onerror = () => reject(new Error('Failed to compress image'));
        img.src = url;
    });
}
