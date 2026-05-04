function errorHandler(err, req, res, next) {
    console.error(`[Error] ${err.message}`);

    let userMessage = err.message;
    
    // Map known provider error codes to friendly messages
    switch (err.message) {
        case 'INVALID_KEY':
            userMessage = 'Invalid API key. Please check your key in Settings.';
            break;
        case 'RATE_LIMITED':
            userMessage = 'Rate limit exceeded. Please wait a moment.';
            break;
        case 'PROVIDER_ERROR':
            userMessage = 'Provider unavailable. Please try again later.';
            break;
        case 'PARSE_ERROR':
            userMessage = 'Failed to parse response from provider.';
            break;
    }

    res.status(500).json({ error: userMessage });
}

module.exports = errorHandler;
