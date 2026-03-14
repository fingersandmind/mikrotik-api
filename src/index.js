const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const apiKeyAuth = require('./middleware/auth');
const ipWhitelist = require('./middleware/ipWhitelist');
const requestLogger = require('./middleware/requestLogger');
const routerRoutes = require('./routes/router');

const app = express();

// Security headers
app.use(helmet());

// Disable server fingerprinting
app.disable('x-powered-by');

// Trust proxy (needed if behind Cloudflare Tunnel / reverse proxy)
app.set('trust proxy', 1);

// Request logging
app.use(requestLogger);

// Rate limiting — max 30 requests per minute per IP
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, try again later' },
});
app.use(limiter);

// Parse JSON with size limit
app.use(express.json({ limit: '10kb' }));

// IP whitelist — applied to all routes
app.use(ipWhitelist);

// Health check — requires IP whitelist but no API key (for monitoring)
app.get('/api/health', routerRoutes);

// All other routes require API key
app.use('/api', apiKeyAuth, routerRoutes);

// Block all other routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.listen(config.port, () => {
    console.log(`MikroTik API server running on port ${config.port}`);

    if (config.allowedIps.length > 0) {
        console.log(`IP whitelist enabled: ${config.allowedIps.join(', ')}`);
    } else {
        console.warn(
            'WARNING: No IP whitelist configured. Set ALLOWED_IPS in .env for production.'
        );
    }
});
