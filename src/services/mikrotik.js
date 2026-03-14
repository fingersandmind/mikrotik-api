const { RouterOSAPI } = require('node-routeros');
const config = require('../config');

function createConnection() {
    return new RouterOSAPI({
        host: config.mikrotik.host,
        port: config.mikrotik.port,
        user: config.mikrotik.user,
        password: config.mikrotik.password,
        timeout: 10,
    });
}

/**
 * Disconnect a single subscriber on an existing connection.
 */
async function disconnectOne(conn, pppoeUsername) {
    const secrets = await conn.write('/ppp/secret/print', [
        `?name=${pppoeUsername}`,
    ]);

    if (secrets.length === 0) {
        return { status: 'error', username: pppoeUsername, error: 'PPPoE secret not found' };
    }

    await conn.write('/ppp/secret/set', [
        `=.id=${secrets[0]['.id']}`,
        '=disabled=yes',
    ]);

    const active = await conn.write('/ppp/active/print', [
        `?name=${pppoeUsername}`,
    ]);

    if (active.length > 0) {
        await conn.write('/ppp/active/remove', [
            `=.id=${active[0]['.id']}`,
        ]);
    }

    return { status: 'disconnected', username: pppoeUsername };
}

/**
 * Reconnect a single subscriber on an existing connection.
 */
async function reconnectOne(conn, pppoeUsername) {
    const secrets = await conn.write('/ppp/secret/print', [
        `?name=${pppoeUsername}`,
    ]);

    if (secrets.length === 0) {
        return { status: 'error', username: pppoeUsername, error: 'PPPoE secret not found' };
    }

    await conn.write('/ppp/secret/set', [
        `=.id=${secrets[0]['.id']}`,
        '=disabled=no',
    ]);

    return { status: 'reconnected', username: pppoeUsername };
}

/**
 * Disconnect a subscriber by removing their active PPPoE session
 * and disabling their PPPoE secret.
 */
async function disconnect(pppoeUsername) {
    const conn = createConnection();

    try {
        await conn.connect();
        const result = await disconnectOne(conn, pppoeUsername);

        if (result.status === 'error') {
            throw new Error(result.error);
        }

        return result;
    } finally {
        conn.close();
    }
}

/**
 * Reconnect a subscriber by re-enabling their PPPoE secret.
 * The subscriber's device will auto-reconnect via PPPoE retry.
 */
async function reconnect(pppoeUsername) {
    const conn = createConnection();

    try {
        await conn.connect();
        const result = await reconnectOne(conn, pppoeUsername);

        if (result.status === 'error') {
            throw new Error(result.error);
        }

        return result;
    } finally {
        conn.close();
    }
}

/**
 * Disconnect multiple subscribers using a single connection.
 */
async function batchDisconnect(pppoeUsernames) {
    const conn = createConnection();

    try {
        await conn.connect();

        const results = [];
        for (const username of pppoeUsernames) {
            try {
                const result = await disconnectOne(conn, username);
                results.push(result);
            } catch (err) {
                results.push({ status: 'error', username, error: err.message });
            }
        }

        return results;
    } finally {
        conn.close();
    }
}

/**
 * Reconnect multiple subscribers using a single connection.
 */
async function batchReconnect(pppoeUsernames) {
    const conn = createConnection();

    try {
        await conn.connect();

        const results = [];
        for (const username of pppoeUsernames) {
            try {
                const result = await reconnectOne(conn, username);
                results.push(result);
            } catch (err) {
                results.push({ status: 'error', username, error: err.message });
            }
        }

        return results;
    } finally {
        conn.close();
    }
}

/**
 * List all active PPPoE sessions.
 */
async function getActiveSessions() {
    const conn = createConnection();

    try {
        await conn.connect();

        const sessions = await conn.write('/ppp/active/print');

        return sessions.map((s) => ({
            id: s['.id'],
            name: s.name,
            address: s.address,
            uptime: s.uptime,
            callerID: s['caller-id'],
        }));
    } finally {
        conn.close();
    }
}

/**
 * Check if the MikroTik router is reachable.
 */
async function healthCheck() {
    const conn = createConnection();

    try {
        await conn.connect();
        const identity = await conn.write('/system/identity/print');
        conn.close();

        return {
            status: 'ok',
            router: identity[0]?.name || 'unknown',
        };
    } catch (err) {
        return { status: 'error', message: err.message };
    }
}

module.exports = {
    disconnect,
    reconnect,
    batchDisconnect,
    batchReconnect,
    getActiveSessions,
    healthCheck,
};
