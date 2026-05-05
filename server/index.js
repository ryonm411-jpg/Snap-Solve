require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const corsMiddleware = require('./middleware/cors');
const errorHandler = require('./middleware/errors');

const ocrRoute = require('./routes/ocr');
const solveRoute = require('./routes/solve');
const askRoute = require('./routes/ask');

const app = express();
const PORT = process.env.PORT || 3000;

// Render is behind a reverse proxy; trust it to get the real client IP
app.set('trust proxy', 1);

// Global Rate Limiter: max 60 requests per IP per 24 hours
const limiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 60, // limit each IP to 60 requests per windowMs
    message: { error: 'Too many requests from this IP. Please try again tomorrow, or use your own API key.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Middleware
app.use(limiter);
app.use(corsMiddleware);
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/ocr', ocrRoute);
app.use('/api/solve', solveRoute);
app.use('/api/ask', askRoute);

// Basic health check route
app.get('/', (req, res) => {
    res.json({ status: 'SnapSolve backend is running' });
});

// Global Error Handler
app.use(errorHandler);

// Start server — bind to 0.0.0.0 for cloud platform compatibility
app.listen(PORT, '0.0.0.0', () => {
    console.log(`SnapSolve server running on port ${PORT}`);
});
