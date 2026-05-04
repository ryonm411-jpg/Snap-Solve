document.addEventListener('DOMContentLoaded', () => {
    const pasteBtn = document.getElementById('paste-btn');
    const statusMessage = document.getElementById('status-message');
    const imageContainer = document.getElementById('image-container');
    const placeholder = document.getElementById('placeholder');
    const pastedImage = document.getElementById('pasted-image');
    const ocrResultContainer = document.getElementById('ocr-result-container');
    const ocrLoading = document.getElementById('ocr-loading');
    const ocrText = document.getElementById('ocr-text');

    let isWatching = false;
    let watchInterval = null;
    let lastImageSize = 0;
    let isProcessing = false;

    /**
     * Converts a Blob to a Base64 string
     */
    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                const MAX_WIDTH = 1200;
                const MAX_HEIGHT = 1200;
                
                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, width, height);
                
                const base64String = canvas.toDataURL('image/jpeg', 0.8);
                URL.revokeObjectURL(img.src);
                resolve(base64String);
            };
            img.onerror = () => {
                URL.revokeObjectURL(img.src);
                reject(new Error('Failed to load image for compression'));
            };
            img.src = URL.createObjectURL(blob);
        });
    }

    async function performOCR(base64Image) {
        try {
            const response = await fetch('/api/ocr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Image })
            });

            if (!response.ok) {
                throw new Error(`Proxy returned status ${response.status}`);
            }

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            if (data.IsErroredOnProcessing) {
                let errMsg = data.ErrorMessage;
                if (Array.isArray(errMsg)) errMsg = errMsg.join(', ');
                else if (typeof errMsg === 'object') errMsg = JSON.stringify(errMsg);
                throw new Error(errMsg || 'OCR Processing Error');
            }

            if (data.ParsedResults && data.ParsedResults.length > 0) {
                return data.ParsedResults[0].ParsedText || 'No text found in the image.';
            }
            return 'No text found in the image.';
        } catch (error) {
            console.error('OCR Error:', error);
            throw new Error('OCR failed: ' + error.message);
        }
    }

    function setStatus(message, type) {
        statusMessage.textContent = message;
        statusMessage.className = `status ${type}`;
        
        // Clear success message after 3 seconds
        if (type === 'success') {
            setTimeout(() => {
                if (statusMessage.textContent === message) {
                    statusMessage.textContent = '';
                }
            }, 3000);
        }
    }

    async function processClipboard() {
        if (isProcessing) return;
        isProcessing = true;
        try {
            if (!navigator.clipboard || !navigator.clipboard.read) {
                throw new Error('Clipboard API not supported in this browser. (Note: requires a secure context or localhost)');
            }

            const clipboardItems = await navigator.clipboard.read();
            let imageFound = false;

            for (const clipboardItem of clipboardItems) {
                const imageTypes = clipboardItem.types.filter(type => type.startsWith('image/'));

                if (imageTypes.length > 0) {
                    const blob = await clipboardItem.getType(imageTypes[0]);
                    lastImageSize = blob.size;
                    const imageUrl = URL.createObjectURL(blob);

                    pastedImage.src = imageUrl;
                    pastedImage.style.display = 'block';
                    placeholder.style.display = 'none';

                    setStatus('Image pasted successfully! Extracting text...', 'success');
                    imageFound = true;

                    ocrResultContainer.style.display = 'block';
                    ocrLoading.style.display = 'flex';
                    ocrText.style.display = 'none';
                    ocrText.value = '';

                    try {
                        const base64String = await blobToBase64(blob);
                        const extractedText = await performOCR(base64String);

                        ocrLoading.style.display = 'none';
                        ocrText.value = extractedText;
                        ocrText.style.display = 'block';

                        try {
                            await navigator.clipboard.writeText(extractedText);
                            setStatus('Text copied to clipboard. You can now paste it anywhere.', 'success');
                        } catch (clipboardError) {
                            console.error('Clipboard copy failed:', clipboardError);
                            setStatus('Text extracted successfully! (Auto-copy failed)', 'success');
                        }
                    } catch (ocrError) {
                        console.error('OCR Error:', ocrError);
                        ocrLoading.style.display = 'none';
                        ocrText.style.display = 'block';
                        ocrText.value = `Error: ${ocrError.message}`;
                        setStatus('Failed to extract text from the image.', 'error');
                    }

                    break;
                }
            }

            if (!imageFound) {
                setStatus('No image found in the clipboard. Try copying an image first.', 'error');
            }

        } catch (error) {
            console.error('Failed to read clipboard:', error);
            if (error.name === 'NotAllowedError') {
                setStatus('Permission to read clipboard was denied. Please allow clipboard access.', 'error');
            } else {
                setStatus(error.message || 'Failed to read from clipboard.', 'error');
            }
        } finally {
            isProcessing = false;
        }
    }

    // Button click
    pasteBtn.addEventListener('click', processClipboard);

    async function checkClipboard() {
        if (!document.hasFocus()) return;
        try {
            const clipboardItems = await navigator.clipboard.read();
            for (const clipboardItem of clipboardItems) {
                const imageTypes = clipboardItem.types.filter(type => type.startsWith('image/'));
                if (imageTypes.length > 0) {
                    const blob = await clipboardItem.getType(imageTypes[0]);
                    if (blob.size !== lastImageSize) {
                        lastImageSize = blob.size;
                        await processClipboard();
                    }
                    break;
                }
            }
        } catch (error) {
            // Ignore background read errors
        }
    }

    // Keyboard shortcut: Ctrl + Shift + V
    // Only fires when the document has focus and the user is not typing in an input/textarea
    document.addEventListener('keydown', (e) => {
        const tag = document.activeElement.tagName;
        const isTyping = (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable);

        if (e.ctrlKey && e.shiftKey && e.key === 'V' && !isTyping) {
            e.preventDefault();
            
            if (!isWatching) {
                isWatching = true;
                setStatus('Watch mode enabled', 'success');
                checkClipboard();
                watchInterval = setInterval(checkClipboard, 1000);
            } else {
                isWatching = false;
                setStatus('Watch mode disabled', 'success');
                if (watchInterval) {
                    clearInterval(watchInterval);
                    watchInterval = null;
                }
            }
        }
    });
});
