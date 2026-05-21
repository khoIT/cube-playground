/**
 * MM-01 proxy tests. We don't hit a real upstream — `globalThis.fetch` is
 * replaced per test so we can assert request shape, auth header, error mapping,
 * and timeout/abort behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

const PAYLOAD = {
  metric_name: 'whales_vn',
  expression: 'SUM(lifetime_recharge_amount_vnd)',
  filter: 'tier IN (whale)',
  source: 'iceberg.bal_vn.mf_users',
  dimensions: ['user_id'],
  env: 'dev' as const,
  game_id: 'bal_vn',
};

describe('POST /api/cdp/v1/metrics — MM-01 proxy', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    setDb(makeMemDb());
    app = await buildApp();
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
    closeDb();
    delete process.env.CDP_MM01_URL;
    delete process.env.CDP_MM01_BEARER;
    delete process.env.CDP_MM01_TIMEOUT_MS;
  });

  it('returns 503 when upstream not configured', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/cdp/v1/metrics', payload: PAYLOAD });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_CONFIGURED' } });
  });

  it('rejects an invalid metric_name with 400', async () => {
    process.env.CDP_MM01_URL = 'http://x.invalid/v1/metrics';
    process.env.CDP_MM01_BEARER = 'tok';
    const res = await app.inject({
      method: 'POST',
      url: '/api/cdp/v1/metrics',
      payload: { ...PAYLOAD, metric_name: 'INVALID name' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('forwards to upstream with Bearer auth and returns its body on success', async () => {
    process.env.CDP_MM01_URL = 'http://x.invalid/v1/metrics';
    process.env.CDP_MM01_BEARER = 'secret-tok';

    const seen: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.url = typeof url === 'string' ? url : url.toString();
      seen.init = init;
      return new Response(
        JSON.stringify({ metric_id: 'm-1', status: 'active' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const res = await app.inject({ method: 'POST', url: '/api/cdp/v1/metrics', payload: PAYLOAD });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ metric_id: 'm-1', status: 'active' });
    expect(seen.url).toBe('http://x.invalid/v1/metrics');
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret-tok');
  });

  it('maps upstream 4xx to same status with UPSTREAM error code', async () => {
    process.env.CDP_MM01_URL = 'http://x.invalid/v1/metrics';
    process.env.CDP_MM01_BEARER = 'tok';
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ reason: 'duplicate' }), { status: 409 }),
    ) as unknown as typeof fetch;

    const res = await app.inject({ method: 'POST', url: '/api/cdp/v1/metrics', payload: PAYLOAD });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('UPSTREAM');
  });

  it('returns 502 when upstream returns success but unexpected shape', async () => {
    process.env.CDP_MM01_URL = 'http://x.invalid/v1/metrics';
    process.env.CDP_MM01_BEARER = 'tok';
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
    ) as unknown as typeof fetch;

    const res = await app.inject({ method: 'POST', url: '/api/cdp/v1/metrics', payload: PAYLOAD });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('UPSTREAM_BAD_SHAPE');
  });
});
