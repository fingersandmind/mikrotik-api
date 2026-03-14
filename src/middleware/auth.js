const crypto = require('crypto');
const config = require('../config');

function apiKeyAuth(req, res, next) {
    const key = req.headers['x-api-key'];

    if (!key || !config.apiKey) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Timing-safe comparison to prevent timing attacks
    const keyBuffer = Buffer.from(key);
    const expectedBuffer = Buffer.from(config.apiKey);

    if (
        keyBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(keyBuffer, expectedBuffer)
    ) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
}

module.exports = apiKeyAuth;
