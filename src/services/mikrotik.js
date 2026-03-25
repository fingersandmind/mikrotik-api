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
            lastLoggedOut: secret['last-logged-out'] || null,
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
            lastLoggedOut: match['last-logged-out'] || null,
        };
    } finally {
        safeClose(conn);
    }
}

/**
 * Batch-resolve PPPoE usernames from an array of subscribers.
 * Fetches all secrets once and resolves each subscriber using Map lookups.
 * Resolution priority per subscriber: name match on username,
 * then password/name/comment match on password,
 * then password/comment match on username.
 */
async function resolveSecrets(subscribers, router) {
    const conn = await connectWithFallback(router);

    try {
        const allSecrets = await conn.write('/ppp/secret/print');

        // Build lookup maps (first match wins for duplicates)
        const byName = new Map();
        const byPassword = new Map();
        const byComment = new Map();

        for (const s of allSecrets) {
            if (s.name && !byName.has(s.name)) byName.set(s.name, s);
            if (s.password && !byPassword.has(s.password)) byPassword.set(s.password, s);
            if (s.comment && !byComment.has(s.comment)) byComment.set(s.comment, s);
        }

        const results = subscribers.map((sub) => {
            const { id, pppoe_username, pppoe_password } = sub;
            let match = null;
            let matchedBy = null;

            // 1. Exact name match on username
            if (pppoe_username && byName.has(pppoe_username)) {
                match = byName.get(pppoe_username);
                matchedBy = 'name';
            }

            // 2. Search by password value: password → name → comment
            if (!match && pppoe_password) {
                if (byPassword.has(pppoe_password)) {
                    match = byPassword.get(pppoe_password);
                    matchedBy = 'password';
                } else if (byName.has(pppoe_password)) {
                    match = byName.get(pppoe_password);
                    matchedBy = 'name';
                } else if (byComment.has(pppoe_password)) {
                    match = byComment.get(pppoe_password);
                    matchedBy = 'comment';
                }
            }

            // 3. Search by username value: password → comment
            if (!match && pppoe_username) {
                if (byPassword.has(pppoe_username)) {
                    match = byPassword.get(pppoe_username);
                    matchedBy = 'password';
                } else if (byComment.has(pppoe_username)) {
                    match = byComment.get(pppoe_username);
                    matchedBy = 'comment';
                }
            }

            if (!match) {
                return { id, found: false };
            }

            return {
                id,
                found: true,
                matchedBy,
                name: match.name,
                profile: match.profile,
                comment: match.comment || null,
            };
        });

        const resolved = results.filter((r) => r.found).length;

        return { total: subscribers.length, resolved, unresolved: subscribers.length - resolved, results };
    } finally {
        safeClose(conn);
    }
}

/**
 * Get all PPPoE secrets merged with active session data.
 * Opens one connection, runs two queries, and merges by username.
 */
async function getSecretsWithSessions(router) {
    const conn = await connectWithFallback(router);

    try {
        const [secrets, active] = await Promise.all([
            conn.write('/ppp/secret/print'),
            conn.write('/ppp/active/print'),
        ]);

        // Build active session lookup by name
        const activeByName = new Map();
        for (const s of active) {
            activeByName.set(s.name, s);
        }

        return secrets.map((secret) => {
            const session = activeByName.get(secret.name);
            return {
                name: secret.name,
                password: secret.password || null,
                profile: secret.profile || null,
                comment: secret.comment || null,
                disabled: secret.disabled === 'true',
                active: !!session,
                uptime: session?.uptime || null,
                address: session?.address || null,
                callerID: session?.['caller-id'] || null,
                lastLoggedOut: secret['last-logged-out'] || null,
            };
        });
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
    resolveSecrets,
    getSecretsWithSessions,
    getProfiles,
    healthCheck,
    createSecret,
};
