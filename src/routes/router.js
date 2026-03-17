const express = require('express');
const mikrotik = require('../services/mikrotik');

const router = express.Router();

const MAX_BATCH_SIZE = 100;

/**
 * Extract router connection config from request body or query.
 * If not provided, falls back to .env defaults.
 */
function getRouter(req) {
    const source = req.body?.router || req.query;
    if (!source?.host) return null;
    return {
        host: source.host,
        fallback_host: source.fallback_host || null,
        port: parseInt(source.port) || 8728,
        user: source.user,
        password: source.password,
    };
}

router.get('/profiles', async (req, res) => {
    try {
        const profiles = await mikrotik.getProfiles(getRouter(req));
        res.json({ profiles });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/profiles', async (req, res) => {
    try {
        const profiles = await mikrotik.getProfiles(getRouter(req));
        res.json({ profiles });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/create-secret', async (req, res) => {
    const { pppoe_username, pppoe_password, profile } = req.body;

    if (!pppoe_username) {
        return res.status(400).json({ error: 'pppoe_username is required' });
    }

    if (!pppoe_password) {
        return res.status(400).json({ error: 'pppoe_password is required' });
    }

    try {
        const result = await mikrotik.createSecret(pppoe_username, pppoe_password, profile, getRouter(req));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/disconnect', async (req, res) => {
    const { pppoe_username, profile } = req.body;

    if (!pppoe_username) {
        return res.status(400).json({ error: 'pppoe_username is required' });
    }

    try {
        const result = await mikrotik.disconnect(pppoe_username, profile, getRouter(req));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/reconnect', async (req, res) => {
    const { pppoe_username, profile } = req.body;

    if (!pppoe_username) {
        return res.status(400).json({ error: 'pppoe_username is required' });
    }

    try {
        const result = await mikrotik.reconnect(pppoe_username, profile, getRouter(req));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/batch/disconnect', async (req, res) => {
    const { pppoe_usernames, profile } = req.body;

    if (!Array.isArray(pppoe_usernames) || pppoe_usernames.length === 0) {
        return res.status(400).json({ error: 'pppoe_usernames must be a non-empty array' });
    }

    if (pppoe_usernames.length > MAX_BATCH_SIZE) {
        return res.status(400).json({ error: `Maximum ${MAX_BATCH_SIZE} usernames per batch` });
    }

    try {
        const results = await mikrotik.batchDisconnect(pppoe_usernames, profile, getRouter(req));
        const succeeded = results.filter((r) => r.status !== 'error').length;
        const failed = results.filter((r) => r.status === 'error').length;

        res.json({ total: results.length, succeeded, failed, results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/batch/reconnect', async (req, res) => {
    const { pppoe_usernames, profile } = req.body;

    if (!Array.isArray(pppoe_usernames) || pppoe_usernames.length === 0) {
        return res.status(400).json({ error: 'pppoe_usernames must be a non-empty array' });
    }

    if (pppoe_usernames.length > MAX_BATCH_SIZE) {
        return res.status(400).json({ error: `Maximum ${MAX_BATCH_SIZE} usernames per batch` });
    }

    try {
        const results = await mikrotik.batchReconnect(pppoe_usernames, profile, getRouter(req));
        const succeeded = results.filter((r) => r.status !== 'error').length;
        const failed = results.filter((r) => r.status === 'error').length;

        res.json({ total: results.length, succeeded, failed, results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/secret-status/:username', async (req, res) => {
    try {
        const result = await mikrotik.getSecretStatus(req.params.username, getRouter(req));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/secret-status', async (req, res) => {
    const { pppoe_username } = req.body;

    if (!pppoe_username) {
        return res.status(400).json({ error: 'pppoe_username is required' });
    }

    try {
        const result = await mikrotik.getSecretStatus(pppoe_username, getRouter(req));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/active', async (req, res) => {
    try {
        const sessions = await mikrotik.getActiveSessions(getRouter(req));
        res.json(sessions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/active', async (req, res) => {
    try {
        const sessions = await mikrotik.getActiveSessions(getRouter(req));
        res.json(sessions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/health', async (req, res) => {
    try {
        const result = await mikrotik.healthCheck(getRouter(req));
        const status = result.status === 'ok' ? 200 : 503;
        res.status(status).json(result);
    } catch (err) {
        res.status(503).json({ status: 'error', message: err.message });
    }
});

router.post('/health', async (req, res) => {
    try {
        const result = await mikrotik.healthCheck(getRouter(req));
        const status = result.status === 'ok' ? 200 : 503;
        res.status(status).json(result);
    } catch (err) {
        res.status(503).json({ status: 'error', message: err.message });
    }
});

module.exports = router;
