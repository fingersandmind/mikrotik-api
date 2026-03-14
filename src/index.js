const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const apiKeyAuth = require('./middleware/auth');
const routerRoutes = require('./routes/router');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check is public (for monitoring)
app.get('/api/health', routerRoutes);

// All other routes require API key
app.use('/api', apiKeyAuth, routerRoutes);

app.listen(config.port, () => {
    console.log(`MikroTik API server running on port ${config.port}`);
});
