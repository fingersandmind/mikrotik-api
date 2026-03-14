const express = require('express');
const mikrotik = require('../services/mikrotik');

const router = express.Router();

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
