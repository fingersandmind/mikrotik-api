function requestLogger(req, res, next) {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const clientIp =
            req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
            req.socket.remoteAddress;

        console.log(
            `[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms - ${clientIp}`
        );
    });

    next();
}

module.exports = requestLogger;
