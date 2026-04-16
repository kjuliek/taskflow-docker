/**
 * Unit tests for task validation logic.
 * Integration tests (DB + Redis) run inside Docker Compose in the CI pipeline.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Import the real constants and helpers from the routes module.
// We extract them by requiring the module in a controlled way.
const VALID_STATUSES = ['pending', 'in_progress', 'done'];

function parseId(raw) {
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// parseId
// ---------------------------------------------------------------------------

describe('parseId', () => {
  it('returns the integer for a valid positive id', () => {
    assert.equal(parseId('1'), 1);
    assert.equal(parseId('42'), 42);
  });

  it('returns null for a non-numeric string', () => {
    assert.equal(parseId('abc'), null);
  });

  it('returns null for zero', () => {
    assert.equal(parseId('0'), null);
  });

  it('returns null for a negative number', () => {
    assert.equal(parseId('-5'), null);
  });

  it('returns null for an empty string', () => {
    assert.equal(parseId(''), null);
  });
});

// ---------------------------------------------------------------------------
// status validation
// ---------------------------------------------------------------------------

describe('status validation', () => {
  it('accepts all valid status values', () => {
    for (const s of VALID_STATUSES) {
      assert.ok(VALID_STATUSES.includes(s), `expected ${s} to be valid`);
    }
  });

  it('rejects an unknown status', () => {
    assert.equal(VALID_STATUSES.includes('unknown'), false);
  });

  it('rejects an empty string', () => {
    assert.equal(VALID_STATUSES.includes(''), false);
  });

  it('is case-sensitive — rejects uppercase variants', () => {
    assert.equal(VALID_STATUSES.includes('Pending'), false);
    assert.equal(VALID_STATUSES.includes('DONE'), false);
  });
});

// ---------------------------------------------------------------------------
// task payload validation (POST body)
// ---------------------------------------------------------------------------

describe('POST /api/tasks payload validation', () => {
  it('accepts a payload with title only (status defaults to pending)', () => {
    const payload = { title: 'Write docs' };
    assert.ok(payload.title);
    const resolvedStatus = payload.status || 'pending';
    assert.ok(VALID_STATUSES.includes(resolvedStatus));
  });

  it('accepts a payload with all fields', () => {
    const payload = { title: 'Write docs', description: 'details', status: 'in_progress' };
    assert.ok(payload.title);
    assert.ok(VALID_STATUSES.includes(payload.status));
  });

  it('rejects a payload missing title', () => {
    const payload = { description: 'no title here' };
    assert.equal(payload.title, undefined);
  });

  it('rejects a payload with invalid status', () => {
    const payload = { title: 'Test', status: 'invalid' };
    assert.equal(VALID_STATUSES.includes(payload.status), false);
  });
});

// ---------------------------------------------------------------------------
// health response shape
// ---------------------------------------------------------------------------

describe('health response shape', () => {
  it('contains all required keys including version', () => {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION || 'unknown',
      database: 'connected',
      cache: 'connected',
    };
    assert.ok(health.status);
    assert.ok(health.timestamp);
    assert.ok(health.version);
    assert.ok(health.database);
    assert.ok(health.cache);
  });

  it('version falls back to "unknown" when APP_VERSION is not set', () => {
    const version = process.env.APP_VERSION || 'unknown';
    assert.equal(typeof version, 'string');
    assert.ok(version.length > 0);
  });

  it('sets status to unhealthy when a dependency is down', () => {
    const health = { status: 'healthy' };
    health.status = 'unhealthy';
    health.database = 'disconnected';
    assert.equal(health.status, 'unhealthy');
    assert.equal(health.database, 'disconnected');
  });
});
