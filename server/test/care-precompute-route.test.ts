/**
 * Care precompute admin routes — admin-gated runs list + manual trigger.
 * Real-auth mode to verify the role + feature gate fires. Run/cache data is
 * seeded directly via the stores; no live agent or Trino needed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';
import { recordCareRun } from '../src/db/segment-care-run-store.js';
import { writeCareCache } from '../src/db/segment-care-cache-store.js';
import { resetCareTriggerState } from '../src/services/care-precompute-scheduler.js';
import type { CsCarePayload } from '../src/services/cs-care-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

const samplePayload: CsCarePayload = {
  segmentId: 'seg-1',
  gameId: 'cfm_vn',
  productId: 1,
  coverage: { totalMembers: 10, contactedMembers: 2, pct: 20, truncated: false },
  freshness: { csMaxLogDate: '2026-06-14' },
  pulse: { tickets: 5, contacted: 2, openUnresolved: 0, negativeSentiment: 0, lowRating: 0 },
  issueMix: [],
  watchlist: [],
  csImpact: null,
};

describe('care-precompute admin routes (real-auth)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let editorAuth: { authorization: string };
  let adminAuth: { authorization: string };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    resetCareTriggerState();
    upsertUserAccess({ email: 'editor@corp.com', role: 'editor', status: 'active' });
    upsertUserAccess({ email: 'admin@corp.com', role: 'admin', status: 'active' });
    writeCareCache('seg-1', 'cfm_vn', samplePayload);
    recordCareRun({
      segmentId: 'seg-1', gameId: 'cfm_vn', source: 'cron',
      startedAt: '2026-06-14T03:00:00.000Z', finishedAt: '2026-06-14T03:00:04.000Z',
      status: 'ok', tickets: 5, contacted: 2, elapsedMs: 4000,
    });
    app = await buildApp();
    editorAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'e', username: 'editor', email: 'editor@corp.com', role: 'editor' })}` };
    adminAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'a', username: 'admin', email: 'admin@corp.com', role: 'admin' })}` };
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  it('401 unauthenticated, 403 non-admin on the runs list', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/care-precompute/runs' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/admin/care-precompute/runs', headers: editorAuth })).statusCode).toBe(403);
  });

  it('admin lists runs + cache freshness + window', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/care-precompute/runs', headers: adminAuth });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      runs: Array<{ segmentId: string; status: string }>;
      cache: Array<{ segmentId: string; hasPayload: boolean }>;
      window: { startMin: number; endMin: number };
    };
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({ segmentId: 'seg-1', status: 'ok' });
    expect(body.cache.find((c) => c.segmentId === 'seg-1')?.hasPayload).toBe(true);
    expect(body.window).toEqual({ startMin: 180, endMin: 360 }); // 03:00-06:00 default
  });

  it('manual trigger returns 202, then 429 within the cooldown', async () => {
    const first = await app.inject({
      method: 'POST', url: '/api/admin/care-precompute/runs', headers: adminAuth,
      payload: { segmentId: 'seg-1' },
    });
    expect(first.statusCode).toBe(202);

    const second = await app.inject({
      method: 'POST', url: '/api/admin/care-precompute/runs', headers: adminAuth,
      payload: { segmentId: 'seg-1' },
    });
    expect(second.statusCode).toBe(429);
    expect(second.headers['retry-after']).toBeDefined();
  });

  it('400 on a missing segmentId; 403 for non-admin on trigger', async () => {
    expect((await app.inject({
      method: 'POST', url: '/api/admin/care-precompute/runs', headers: adminAuth, payload: {},
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'POST', url: '/api/admin/care-precompute/runs', headers: editorAuth, payload: { segmentId: 'seg-1' },
    })).statusCode).toBe(403);
  });
});
