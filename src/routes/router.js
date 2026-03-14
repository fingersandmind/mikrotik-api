const express = require('express');
const mikrotik = require('../services/mikrotik');

const router = express.Router();

const MAX_BATCH_SIZE = 100;

router.post('/disconnect', async (req, res) => {
    const { pppoe_username } = req.body;

    if (!pppoe_username) {
        return res.status(400).json({ error: 'pppoe_username is required' });
    }

    try {
        const result = await mikrotik.disconnect(pppoe_username);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/reconnect', async (req, res) => {
    const { pppoe_username } = req.body;

    if (!pppoe_username) {
        return res.status(400).json({ error: 'pppoe_username is required' });
    }

    try {
        const result = await mikrotik.reconnect(pppoe_username);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/batch/disconnect', async (req, res) => {
    const { pppoe_usernames } = req.body;

    if (!Array.isArray(pppoe_usernames) || pppoe_usernames.length === 0) {
        return res.status(400).json({ error: 'pppoe_usernames must be a non-empty array' });
    }

    if (pppoe_usernames.length > MAX_BATCH_SIZE) {
        return res.status(400).json({ error: `Maximum ${MAX_BATCH_SIZE} usernames per batch` });
    }

    try {
        const results = await mikrotik.batchDisconnect(pppoe_usernames);
        const succeeded = results.filter((r) => r.status !== 'error').length;
        const failed = results.filter((r) => r.status === 'error').length;

        res.json({ total: results.length, succeeded, failed, results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/batch/reconnect', async (req, res) => {
    const { pppoe_usernames } = req.body;

    if (!Array.isArray(pppoe_usernames) || pppoe_usernames.length === 0) {
        return res.status(400).json({ error: 'pppoe_usernames must be a non-empty array' });
    }

    if (pppoe_usernames.length > MAX_BATCH_SIZE) {
        return res.status(400).json({ error: `Maximum ${MAX_BATCH_SIZE} usernames per batch` });
    }

    try {
        const results = await mikrotik.batchReconnect(pppoe_usernames);
        const succeeded = results.filter((r) => r.status !== 'error').length;
        const failed = results.filter((r) => r.status === 'error').length;

        res.json({ total: results.length, succeeded, failed, results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/active', async (req, res) => {
    try {
        const sessions = await mikrotik.getActiveSessions();
        res.json(sessions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/health', async (req, res) => {
    const result = await mikrotik.healthCheck();
    const status = result.status === 'ok' ? 200 : 503;
    res.status(status).json(result);
});

module.exports = router;
