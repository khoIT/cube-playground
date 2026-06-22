/**
 * Route tests for POST /api/segments/dimension-values — distinct values of a
 * grouping dimension, for the "Build segment from this" seed picker. The Cube
 * read is stubbed (loadWithContinueWait); this locks the endpoint's own logic:
 * dedup, the 100-row cap, null-row skip, and the best-effort never-500 contract.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';

vi.mock('../src/services/load-with-continue-wait.js', () => ({
  loadWithContinueWait: vi.fn(),
}));
import * as loadSvc from '../src/services/load-with-continue-wait.js';
const mockLoad = loadSvc.loadWithContinueWait as MockedFunction<typeof loadSvc.loadWithContinueWait>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

describe('POST /api/segments/dimension-values', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let auth: { authorization: string };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    mockLoad.mockReset();
    app = await buildApp();
    auth = {
      authorization: `Bearer ${await signAppJwt({ sub: 'alice-sub', username: 'alice-sub', email: 'alice@corp.com', role: 'editor' })}`,
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  function call(body: unknown) {
    return app.inject({ method: 'POST', url: '/api/segments/dimension-values', headers: auth, payload: body as object });
  }

  const DIM = 'mf_users.payer_tier';
  const QUERY = { measures: ['mf_users.ltv_total_vnd'], dimensions: [DIM], order: { 'mf_users.ltv_total_vnd': 'desc' }, limit: 10 };

  it('projects + dedups the dimension column and skips null rows', async () => {
    mockLoad.mockResolvedValue({
      data: [
        { [DIM]: 'whale', 'mf_users.ltv_total_vnd': 9 },
        { [DIM]: 'dolphin', 'mf_users.ltv_total_vnd': 5 },
        { [DIM]: 'whale', 'mf_users.ltv_total_vnd': 1 }, // dup
        { [DIM]: null, 'mf_users.ltv_total_vnd': 0 }, // null skipped
      ],
    } as never);
    const res = await call({ game_id: 'jus_vn', dimension: DIM, query: QUERY });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.values).toEqual(['whale', 'dolphin']);
    expect(body.approx).toBe(false);
  });

  it('caps the underlying query limit at 100', async () => {
    mockLoad.mockResolvedValue({ data: [] } as never);
    await call({ game_id: 'jus_vn', dimension: DIM, query: { ...QUERY, limit: 5000 } });
    const sentQuery = mockLoad.mock.calls[0][0] as { limit: number; measures: string[] };
    expect(sentQuery.limit).toBe(100);
    expect(sentQuery.measures).toHaveLength(1); // measures sliced to 1
  });

  it('degrades a Cube failure to an empty list (never 500)', async () => {
    mockLoad.mockRejectedValue(new Error('trino timed out'));
    const res = await call({ game_id: 'jus_vn', dimension: DIM, query: QUERY });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.values).toEqual([]);
    expect(body.reason).toMatch('query_error');
  });

  it('rejects a body missing dimension with 400', async () => {
    const res = await call({ game_id: 'jus_vn', query: QUERY });
    expect(res.statusCode).toBe(400);
    expect(mockLoad).not.toHaveBeenCalled();
  });
});
