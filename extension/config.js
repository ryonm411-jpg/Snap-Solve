// config.js — API endpoint configuration
// Set DEV = true when running the local PowerShell server
const DEV = true;

export const API_BASE = DEV
    ? 'http://localhost:3000'
    : 'https://snapsolve-api.onrender.com';

export const API = {
    OCR:   `${API_BASE}/api/ocr`,
    SOLVE: `${API_BASE}/api/solve`,
    ASK:   `${API_BASE}/api/ask`,
    SNIP:  `${API_BASE}/api/snip`,
    CLIPBOARD: `${API_BASE}/api/set-clipboard`,
};
