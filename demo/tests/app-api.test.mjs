import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError } from '../src/app-api.js';

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('cookie mutations carry CSRF, origin, JSON, and idempotency headers', async () => {
  const calls = [];
  const api = createApiClient({
    origin: 'http://127.0.0.1:3001',
    accountId: 'account-a',
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response(200, { revision: 8, data: { version: 1 } }); },
  });

  await api.putWorkspace({ expectedRevision: 7, data: { version: 1 }, idempotencyKey: 'write-7' });
  assert.equal(calls[0].url, '/api/v1/workspace');
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.headers['X-Socrates-CSRF'], '1');
  assert.equal(calls[0].options.headers.Origin, 'http://127.0.0.1:3001');
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'write-7');
  assert.equal(calls[0].options.headers['X-Socrates-Account'], 'account-a');
  assert.deepEqual(JSON.parse(calls[0].options.body), { expectedRevision: 7, data: { version: 1 } });
});

test('API error envelopes retain conflict recovery fields', async () => {
  const api = createApiClient({
    fetchImpl: async () => response(409, { error: { code: 'VERSION_CONFLICT', message: 'Reload required', currentRevision: 12, details: { source: 'api' } } }),
  });

  await assert.rejects(
    api.getWorkspace(),
    (error) => error instanceof ApiError && error.status === 409 && error.code === 'VERSION_CONFLICT' && error.currentRevision === 12 && error.details.source === 'api',
  );
});
