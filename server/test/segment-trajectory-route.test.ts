/**
 * Trajectory route — guard parity (404 unknown / non-predicate), days clamping
 * pass-through, TTL cache (second hit issues zero Trino reads), 502 surface on
 * lakehouse failure. Trino reader mocked; auth + segment store run for real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const readSizeSeriesMock = vi.fn();
const readDeltaSeriesMock = vi.fn();
vi.mock('../src/lakehouse/segment-trajectory-reader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lakehouse/segment-trajectory-reader.js')>();
  return {
    ...actual,
    readSizeSeries: (...args: unknown[]) => readSizeSeriesMock(...args),
    readDeltaSeries: (...args: unknown[]) => readDeltaSeriesMock(...args),
  };
});

import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';
import { __clearTrajectoryCache } from '../src/routes/segment-trajectory.js';

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

describe('GET /api/segments/:id/trajectory', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let auth: { authorization: string };
  let predicateId: string;
  let manualId: string;

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    __clearTrajectoryCache();
    readSizeSeriesMock.mockReset();
    readDeltaSeriesMock.mockReset();
    readSizeSeriesMock.mockResolvedValue([{ date: '2026-06-10', members: 100 }]);
    readDeltaSeriesMock.mockResolvedValue([{ date: '2026-06-10', entered: 100, exited: 0 }]);
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    app = await buildApp();
    auth = {
      authorization: `Bearer ${await signAppJwt({ sub: 'alice-sub', username: 'alice', email: 'alice@corp.com', role: 'editor' })}`,
    };

    const pred = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: auth,
      payload: {
        name: 'trajectory predicate seg',
        type: 'predicate',
        cube: 'mf_users',
        game_id: 'cfm_vn',
        cube_query_json: '{"dimensions":["mf_users.user_id"]}',
        predicate_tree_json: '{"op":"and","children":[]}',
      },
    });
    expect(pred.statusCode).toBe(201);
    predicateId = pred.json().id;

    const man = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: auth,
      payload: { name: 'manual seg', type: 'manual', uid_list: ['u1'], game_id: 'cfm_vn' },
    });
    expect(man.statusCode).toBe(201);
    manualId = man.json().id;
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  it('returns size + delta series for a predicate segment, clamping days', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/segments/${predicateId}/trajectory?days=9999`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.days).toBe(180);
    expect(body.size).toEqual([{ date: '2026-06-10', members: 100 }]);
    expect(body.delta).toEqual([{ date: '2026-06-10', entered: 100, exited: 0 }]);
    expect(body.empty).toBe(false);
    expect(readSizeSeriesMock.mock.calls[0][2]).toBe(180);
  });

  it('serves a repeat view from cache with zero Trino reads', async () => {
    await app.inject({ method: 'GET', url: `/api/segments/${predicateId}/trajectory`, headers: auth });
    await app.inject({ method: 'GET', url: `/api/segments/${predicateId}/trajectory`, headers: auth });
    expect(readSizeSeriesMock).toHaveBeenCalledTimes(1);
    expect(readDeltaSeriesMock).toHaveBeenCalledTimes(1);
  });

  it('404s for unknown and non-predicate segments before touching Trino', async () => {
    const unknown = await app.inject({ method: 'GET', url: '/api/segments/nope/trajectory', headers: auth });
    expect(unknown.statusCode).toBe(404);
    const manual = await app.inject({ method: 'GET', url: `/api/segments/${manualId}/trajectory`, headers: auth });
    expect(manual.statusCode).toBe(404);
    expect(readSizeSeriesMock).not.toHaveBeenCalled();
  });

  it('502s when the lakehouse read fails (and does not cache the failure)', async () => {
    readSizeSeriesMock.mockRejectedValueOnce(new Error('trino down'));
    const fail = await app.inject({ method: 'GET', url: `/api/segments/${predicateId}/trajectory`, headers: auth });
    expect(fail.statusCode).toBe(502);
    const ok = await app.inject({ method: 'GET', url: `/api/segments/${predicateId}/trajectory`, headers: auth });
    expect(ok.statusCode).toBe(200);
  });

  it('marks empty:true when no partitions exist yet', async () => {
    readSizeSeriesMock.mockResolvedValue([]);
    readDeltaSeriesMock.mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: `/api/segments/${predicateId}/trajectory`, headers: auth });
    expect(res.json().empty).toBe(true);
  });
});
