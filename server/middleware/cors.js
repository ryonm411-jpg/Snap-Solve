const cors = require('cors');

// Verify requests strictly match the Chrome Extension ID if configured
const corsOptions = {
    origin: function (origin, callback) {
        const allowedExtensionId = process.env.EXTENSION_ID;
        
        // If no EXTENSION_ID is configured, allow all (useful for local dev)
        if (!allowedExtensionId) {
            return callback(null, true);
        }

        // Allow requests with no origin (health checks, server-to-server, curl)
        if (!origin) {
            return callback(null, true);
        }

        // Allow if origin matches the configured extension ID
        if (origin === allowedExtensionId) {
            return callback(null, true);
        }

        // Block everything else
        callback(new Error('Not allowed by CORS. Invalid origin: ' + origin));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

module.exports = cors(corsOptions);
