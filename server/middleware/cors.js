const cors = require('cors');

// Verify requests strictly match the Chrome Extension ID if configured
const corsOptions = {
    origin: function (origin, callback) {
        const allowedExtensionId = process.env.EXTENSION_ID;
        
        // If no EXTENSION_ID is configured, allow all (useful for local dev)
        if (!allowedExtensionId) {
            return callback(null, true);
        }

        // Enforce strict matching against the configured extension origin
        if (origin === allowedExtensionId) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS. Invalid origin.'));
        }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

module.exports = cors(corsOptions);
