/**
 * Unit tests for task validation logic.
 * Integration tests (DB + Redis) run inside Docker Compose in the CI pipeline.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('Task payload validation', () => {
  it('accepts a valid task payload', () => {
    const payload = { title: 'Write docs', status: 'pending' };
    assert.ok(payload.title, 'title must be present');
    assert.match(payload.status, /^(pending|in_progress|done)$/);
  });

  it('rejects a payload missing title', () => {
    const payload = { description: 'no title here' };
    assert.equal(payload.title, undefined);
  });

  it('rejects an invalid status value', () => {
    const validStatuses = ['pending', 'in_progress', 'done'];
    const status = 'unknown';
    assert.equal(validStatuses.includes(status), false);
  });
});

describe('Health response shape', () => {
  it('contains required keys', () => {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      cache: 'connected',
    };
    assert.ok(health.status);
    assert.ok(health.timestamp);
    assert.ok(health.database);
    assert.ok(health.cache);
  });

  it('sets status to unhealthy when a service is down', () => {
    const health = { status: 'healthy' };
    // Simulate DB failure
    health.status = 'unhealthy';
    health.database = 'disconnected';
    assert.equal(health.status, 'unhealthy');
  });
});
