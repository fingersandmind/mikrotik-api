const config = require('../config');

function ipWhitelist(req, res, next) {
    const clientIp =
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.socket.remoteAddress;

    // Normalize IPv6-mapped IPv4 (e.g., ::ffff:127.0.0.1 -> 127.0.0.1)
    const normalizedIp = clientIp?.replace(/^::ffff:/, '');

    if (config.allowedIps.length === 0) {
        // No whitelist configured — allow all (but API key still required)
        return next();
    }

    if (!config.allowedIps.includes(normalizedIp)) {
        console.warn(
            `[BLOCKED] Request from unauthorized IP: ${normalizedIp} - ${req.method} ${req.path}`
        );
        return res.status(403).json({ error: 'Forbidden' });
    }

    next();
}

module.exports = ipWhitelist;
