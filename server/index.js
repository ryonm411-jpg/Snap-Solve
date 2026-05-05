require('dotenv').config();
const express = require('express');
const corsMiddleware = require('./middleware/cors');
const errorHandler = require('./middleware/errors');

const ocrRoute = require('./routes/ocr');
const solveRoute = require('./routes/solve');
const askRoute = require('./routes/ask');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
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
