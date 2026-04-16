const { Router } = require('express');
const { pool, redis } = require('../db');

const router = Router();
const CACHE_KEY = 'tasks:all';
const CACHE_TTL = 60; // seconds

// Helper: invalidate the task list cache after any write
async function invalidateCache() {
  try {
    await redis.del(CACHE_KEY);
  } catch (_) {
    // Cache miss on invalidation is non-fatal
  }
}

// GET /api/tasks — list all tasks (cached)
router.get('/', async (req, res) => {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      return res.json({ source: 'cache', data: JSON.parse(cached) });
    }

    const { rows } = await pool.query(
      'SELECT * FROM tasks ORDER BY created_at DESC'
    );
    await redis.setEx(CACHE_KEY, CACHE_TTL, JSON.stringify(rows));
    return res.json({ source: 'db', data: rows });
  } catch (err) {
    console.error('[GET /tasks]', err);
    return res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// GET /api/tasks/:id — get one task
router.get('/:id', async (req, res) => {
  const { id } = req.params;
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
  try {
    const { rows } = await pool.query(
      `INSERT INTO tasks (title, description, status)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [title, description || null, status || 'pending']
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
  const { id } = req.params;
  const { title, description, status } = req.body;
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
  const { id } = req.params;
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
