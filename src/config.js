require('dotenv').config();

module.exports = {
    port: process.env.PORT || 3000,
    apiKey: process.env.API_KEY,
    mikrotik: {
        host: process.env.MIKROTIK_HOST,
        port: parseInt(process.env.MIKROTIK_PORT) || 8728,
        user: process.env.MIKROTIK_USER,
        password: process.env.MIKROTIK_PASSWORD,
    },
};
