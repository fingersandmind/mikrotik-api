require('dotenv').config();

module.exports = {
    port: process.env.PORT || 3000,
    apiKey: process.env.API_KEY,
    allowedIps: process.env.ALLOWED_IPS
        ? process.env.ALLOWED_IPS.split(',').map((ip) => ip.trim())
        : [],
    mikrotik: {
        host: process.env.MIKROTIK_HOST,
        port: parseInt(process.env.MIKROTIK_PORT) || 8728,
        user: process.env.MIKROTIK_USER,
        password: process.env.MIKROTIK_PASSWORD,
    },
};
