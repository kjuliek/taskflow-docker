const { Pool } = require('pg');
const { createClient } = require('redis');

// --- PostgreSQL -----------------------------------------------------------
// Accepts a full DATABASE_URL (Docker Compose / production) or falls back
// to individual vars for local development without Docker.

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    `postgres://${process.env.POSTGRES_USER || 'taskflow'}:${process.env.POSTGRES_PASSWORD || 'taskflow_password'}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || 'taskflow'}`,
});

// --- Redis ----------------------------------------------------------------
// Accepts a REDIS_URL (Docker Compose / production) or falls back to
// individual vars for local development without Docker.

const redis = createClient({
  url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
});

redis.on('error', (err) => console.error('[Redis] client error:', err));

// --- Schema init ----------------------------------------------------------

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          SERIAL PRIMARY KEY,
      title       VARCHAR(255) NOT NULL,
      description TEXT,
      status      VARCHAR(50)  NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'in_progress', 'done')),
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
  `);
  console.log('[DB] schema ready');
}

module.exports = { pool, redis, initDB };
