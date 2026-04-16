require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { pool, redis, initDB } = require('./db');
const tasksRouter = require('./routes/tasks');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware -----------------------------------------------------------

app.use(cors());
app.use(express.json());

// --- Health check --------------------------------------------------------

app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || 'unknown',
  };

  try {
    await pool.query('SELECT 1');
    health.database = 'connected';
  } catch (e) {
    health.status = 'unhealthy';
    health.database = 'disconnected';
  }

  try {
    await redis.ping();
    health.cache = 'connected';
  } catch (e) {
    health.status = 'unhealthy';
    health.cache = 'disconnected';
  }

  const code = health.status === 'healthy' ? 200 : 503;
  res.status(code).json(health);
});

// --- Routes --------------------------------------------------------------

app.use('/api/tasks', tasksRouter);

// --- 404 fallback --------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// --- Bootstrap -----------------------------------------------------------

async function start() {
  try {
    await redis.connect();
    console.log('[Redis] connected');

    await initDB();

    app.listen(PORT, () => {
      console.log(`[API] listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('[startup] fatal error:', err);
    process.exit(1);
  }
}

start();

module.exports = app; // exported for tests
