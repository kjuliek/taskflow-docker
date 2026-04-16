const { Router } = require('express');
const { pool, redis } = require('../db');

const router = Router();
const CACHE_KEY = 'tasks:all';
const CACHE_TTL = 60; // seconds

const VALID_STATUSES = ['pending', 'in_progress', 'done'];

// Returns a positive integer or null — used to reject non-numeric :id params
function parseId(raw) {
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Helper: invalidate all paginated task list cache entries after any write.
// Keys follow the pattern tasks:all:<limit>:<offset> — we scan and delete them all.
async function invalidateCache() {
  try {
    const keys = await redis.keys(`${CACHE_KEY}:*`);
    if (keys.length > 0) {
      await redis.del(keys);
    }
  } catch (_) {
    // Cache invalidation failure is non-fatal
  }
}

// GET /api/tasks — list tasks with pagination (?limit=20&offset=0)
router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = parseInt(req.query.offset, 10) || 0;

  if (offset < 0) {
    return res.status(400).json({ error: '"offset" must be >= 0' });
  }

  // Cache key includes pagination params so each page is cached independently
  const cacheKey = `${CACHE_KEY}:${limit}:${offset}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const { rows } = await pool.query(
      'SELECT * FROM tasks ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    const { rows: countRows } = await pool.query('SELECT COUNT(*) FROM tasks');
    const total = parseInt(countRows[0].count, 10);

    const payload = { data: rows, total, limit, offset };
    await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(payload));
    return res.json(payload);
  } catch (err) {
    console.error('[GET /tasks]', err);
    return res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// GET /api/tasks/:id — get one task
router.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '"id" must be a positive integer' });

  try {
    const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    return res.json({ data: rows[0] });
  } catch (err) {
    console.error('[GET /tasks/:id]', err);
    return res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// POST /api/tasks — create a task
router.post('/', async (req, res) => {
  const { title, description, status } = req.body;
  if (!title) {
    return res.status(400).json({ error: '"title" is required' });
  }
  const resolvedStatus = status || 'pending';
  if (!VALID_STATUSES.includes(resolvedStatus)) {
    return res.status(400).json({ error: `"status" must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO tasks (title, description, status)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [title, description || null, resolvedStatus]
    );
    await invalidateCache();
    return res.status(201).json({ data: rows[0] });
  } catch (err) {
    console.error('[POST /tasks]', err);
    return res.status(500).json({ error: 'Failed to create task' });
  }
});

// PUT /api/tasks/:id — update a task
router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '"id" must be a positive integer' });

  const { title, description, status } = req.body;
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `"status" must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE tasks
       SET title       = COALESCE($1, title),
           description = COALESCE($2, description),
           status      = COALESCE($3, status),
           updated_at  = NOW()
       WHERE id = $4
       RETURNING *`,
      [title, description, status, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    await invalidateCache();
    return res.json({ data: rows[0] });
  } catch (err) {
    console.error('[PUT /tasks/:id]', err);
    return res.status(500).json({ error: 'Failed to update task' });
  }
});

// DELETE /api/tasks/:id — delete a task
router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '"id" must be a positive integer' });

  try {
    const { rowCount } = await pool.query(
      'DELETE FROM tasks WHERE id = $1',
      [id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    await invalidateCache();
    return res.status(204).send();
  } catch (err) {
    console.error('[DELETE /tasks/:id]', err);
    return res.status(500).json({ error: 'Failed to delete task' });
  }
});

module.exports = router;
