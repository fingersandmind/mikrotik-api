const { RouterOSAPI } = require('node-routeros');
const config = require('../config');

const BATCH_DELAY_MS = config.batchDelayMs;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Safely close a RouterOS connection, ignoring errors.
 */
function safeClose(conn) {
    try { conn.close(); } catch { /* already closed or errored */ }
}

/**
 * Create a connection using provided router config, or fall back to .env defaults.
 */
function createConnection(router, host) {
    return new RouterOSAPI({
        host: host || router?.host || config.mikrotik.host,
        port: router?.port || config.mikrotik.port,
        user: router?.user || config.mikrotik.user,
        password: router?.password || config.mikrotik.password,
        timeout: 10,
    });
}

/**
 * Connect with automatic fallback to secondary host if primary fails.
 */
async function connectWithFallback(router) {
    const conn = createConnection(router);
    try {
        await conn.connect();
        return conn;
    } catch (primaryErr) {
        if (router?.fallback_host) {
            console.warn(`Primary host ${router.host} failed, trying fallback ${router.fallback_host}`);
            const fallbackConn = createConnection(router, router.fallback_host);
            await fallbackConn.connect();
            return fallbackConn;
        }
        throw primaryErr;
    }
}

/**
 * Disconnect a single subscriber on an existing connection.
 */
async function disconnectOne(conn, pppoeUsername, profile) {
    const secrets = await conn.write('/ppp/secret/print', [
        `?name=${pppoeUsername}`,
    ]);

    if (secrets.length === 0) {
        return { status: 'error', username: pppoeUsername, error: 'PPPoE secret not found' };
    }

    if (!profile) {
        return { status: 'error', username: pppoeUsername, error: 'Profile is required for disconnect' };
    }

    await conn.write('/ppp/secret/set', [
        `=.id=${secrets[0]['.id']}`,
        `=profile=${profile}`,
    ]);

    // Remove active session so they reconnect with the new profile
    const active = await conn.write('/ppp/active/print', [
        `?name=${pppoeUsername}`,
    ]);

    if (active.length > 0) {
        await conn.write('/ppp/active/remove', [
            `=.id=${active[0]['.id']}`,
        ]);
    }

    return { status: 'disconnected', username: pppoeUsername, profile };
}

/**
 * Reconnect a single subscriber on an existing connection.
 */
async function reconnectOne(conn, pppoeUsername, profile) {
    const secrets = await conn.write('/ppp/secret/print', [
        `?name=${pppoeUsername}`,
    ]);

    if (secrets.length === 0) {
        return { status: 'error', username: pppoeUsername, error: 'PPPoE secret not found' };
    }

    if (!profile) {
        return { status: 'error', username: pppoeUsername, error: 'Profile is required for reconnect' };
    }

    await conn.write('/ppp/secret/set', [
        `=.id=${secrets[0]['.id']}`,
        `=profile=${profile}`,
    ]);

    // Remove active session so they reconnect with the restored profile
    const active = await conn.write('/ppp/active/print', [
        `?name=${pppoeUsername}`,
    ]);

    if (active.length > 0) {
        await conn.write('/ppp/active/remove', [
            `=.id=${active[0]['.id']}`,
        ]);
    }

    return { status: 'reconnected', username: pppoeUsername, profile };
}

/**
 * Disconnect a subscriber by changing their profile to UNPAID
 * and removing their active session.
 */
async function disconnect(pppoeUsername, profile, router) {
    const conn = await connectWithFallback(router);

    try {
        const result = await disconnectOne(conn, pppoeUsername, profile);

        if (result.status === 'error') {
            throw new Error(result.error);
        }

        return result;
    } finally {
        safeClose(conn);
    }
}

/**
 * Reconnect a subscriber by restoring their plan profile
 * and removing their active session so they reconnect with the new profile.
 */
async function reconnect(pppoeUsername, profile, router) {
    const conn = await connectWithFallback(router);

    try {
        const result = await reconnectOne(conn, pppoeUsername, profile);

        if (result.status === 'error') {
            throw new Error(result.error);
        }

        return result;
    } finally {
        safeClose(conn);
    }
}

/**
 * Disconnect multiple subscribers using a single connection.
 */
async function batchDisconnect(pppoeUsernames, profile, router) {
    const conn = await connectWithFallback(router);

    try {
        const results = [];
        for (let i = 0; i < pppoeUsernames.length; i++) {
            const username = pppoeUsernames[i];
            try {
                const result = await disconnectOne(conn, username, profile);
                results.push(result);
            } catch (err) {
                results.push({ status: 'error', username, error: err.message });
            }

            if (i < pppoeUsernames.length - 1 && BATCH_DELAY_MS > 0) {
                await delay(BATCH_DELAY_MS);
            }
        }

        return results;
    } finally {
        safeClose(conn);
    }
}

/**
 * Reconnect multiple subscribers using a single connection.
 */
async function batchReconnect(pppoeUsernames, profile, router) {
    const conn = await connectWithFallback(router);

    try {
        const results = [];
        for (let i = 0; i < pppoeUsernames.length; i++) {
            const username = pppoeUsernames[i];
            try {
                const result = await reconnectOne(conn, username, profile);
                results.push(result);
            } catch (err) {
                results.push({ status: 'error', username, error: err.message });
            }

            if (i < pppoeUsernames.length - 1 && BATCH_DELAY_MS > 0) {
                await delay(BATCH_DELAY_MS);
            }
        }

        return results;
    } finally {
        safeClose(conn);
    }
}

/**
 * List all active PPPoE sessions.
 */
async function getActiveSessions(router) {
    const conn = await connectWithFallback(router);

    try {
        const sessions = await conn.write('/ppp/active/print');

        return sessions.map((s) => ({
            id: s['.id'],
            name: s.name,
            address: s.address,
            uptime: s.uptime,
            callerID: s['caller-id'],
        }));
    } finally {
        safeClose(conn);
    }
}

/**
 * Get a PPPoE secret's current status and profile.
 */
async function getSecretStatus(pppoeUsername, router) {
    const conn = await connectWithFallback(router);

    try {
        const secrets = await conn.write('/ppp/secret/print', [
            `?name=${pppoeUsername}`,
        ]);

        if (secrets.length === 0) {
            return { found: false };
        }

        const secret = secrets[0];

        // Check if there's an active session for uptime and IP
        const active = await conn.write('/ppp/active/print', [
            `?name=${pppoeUsername}`,
        ]);

        const session = active.length > 0 ? active[0] : null;

        return {
            found: true,
            name: secret.name,
            profile: secret.profile,
            disabled: secret.disabled === 'true',
            active: session !== null,
            uptime: session?.uptime || null,
            address: session?.address || null,
            callerID: session?.['caller-id'] || null,
        };
    } finally {
        safeClose(conn);
    }
}

/**
 * List all PPPoE profiles.
 */
async function getProfiles(router) {
    const conn = await connectWithFallback(router);

    try {
        const profiles = await conn.write('/ppp/profile/print');

        return profiles.map((p) => ({
            name: p.name,
            localAddress: p['local-address'] || '',
            remoteAddress: p['remote-address'] || '',
            rateLimit: p['rate-limit'] || '',
        }));
    } finally {
        safeClose(conn);
    }
}

/**
 * Check if the MikroTik router is reachable.
 */
async function healthCheck(router) {
    const conn = await connectWithFallback(router);

    try {
        const identity = await conn.write('/system/identity/print');

        return {
            status: 'ok',
            router: identity[0]?.name || 'unknown',
        };
    } catch (err) {
        return { status: 'error', message: err.message };
    } finally {
        safeClose(conn);
    }
}

/**
 * Find a PPPoE secret by searching: password → username → comment.
 * Returns the first match found in that priority order.
 */
async function findSecret(searchValue, router) {
    const conn = await connectWithFallback(router);

    try {
        const allSecrets = await conn.write('/ppp/secret/print');

        // Search by password first
        let match = allSecrets.find((s) => s.password === searchValue);
        let matchedBy = 'password';

        // Then by username
        if (!match) {
            match = allSecrets.find((s) => s.name === searchValue);
            matchedBy = 'name';
        }

        // Then by comment
        if (!match) {
            match = allSecrets.find((s) => s.comment && s.comment === searchValue);
            matchedBy = 'comment';
        }

        if (!match) {
            return { found: false };
        }

        // Check if there's an active session
        const active = await conn.write('/ppp/active/print', [
            `?name=${match.name}`,
        ]);

        const session = active.length > 0 ? active[0] : null;

        return {
            found: true,
            matchedBy,
            name: match.name,
            profile: match.profile,
            comment: match.comment || null,
            disabled: match.disabled === 'true',
            active: session !== null,
            uptime: session?.uptime || null,
            address: session?.address || null,
            callerID: session?.['caller-id'] || null,
        };
    } finally {
        safeClose(conn);
    }
}

/**
 * Create a new PPPoE secret on the router.
 */
async function createSecret(pppoeUsername, pppoePassword, profile, router) {
    const conn = await connectWithFallback(router);

    try {
        // Check if secret already exists
        const existing = await conn.write('/ppp/secret/print', [
            `?name=${pppoeUsername}`,
        ]);

        if (existing.length > 0) {
            return { status: 'exists', username: pppoeUsername, profile: existing[0].profile };
        }

        const params = [
            `=name=${pppoeUsername}`,
            `=password=${pppoePassword}`,
            `=service=pppoe`,
        ];

        if (profile) {
            params.push(`=profile=${profile}`);
        }

        await conn.write('/ppp/secret/add', params);

        return { status: 'created', username: pppoeUsername, profile: profile || 'default' };
    } finally {
        safeClose(conn);
    }
}

module.exports = {
    disconnect,
    reconnect,
    batchDisconnect,
    batchReconnect,
    getActiveSessions,
    getSecretStatus,
    findSecret,
    getProfiles,
    healthCheck,
    createSecret,
};
