/**
 * Regression: the four primary movement endpoints must serve last-good on a
 * lakehouse error instead of 502-ing.
 *
 * Before the fix they wrote only the bare cache key on success but read
 * `cacheKey + ':stale'` on error — a key nobody populated — so the documented
 * stale-on-error degradation was dead code and any Trino blip hard-502'd. The
 * fix (a) writes both keys via cacheSetWithStale and (b) reads the `:stale`
 * mirror with cacheGetStale, which ignores the fresh TTL — otherwise the
 * fallback is unreachable (fresh + stale share a TTL, and the fresh-hit
 * short-circuit returns before any catch runs while fresh is still warm).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const readKpiTrendMock = vi.fn();
const readMovementSeriesMock = vi.fn();

vi.mock('../src/lakehouse/segment-movement-reader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lakehouse/segment-movement-reader.js')>();
  return {
    ...actual,
    readKpiTrend: (...a: unknown[]) => readKpiTrendMock(...a),
    readMovementSeries: (...a: unknown[]) => readMovementSeriesMock(...a),
    readStateDistribution: vi.fn().mockResolvedValue([]),
    readStateDistributionTrend: vi.fn().mockResolvedValue([]),
    readCadenceHistory: vi.fn().mockResolvedValue([]),
  };
});

import { buildApp } from '../src/index.js';
import { setDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';
import { __clearMovementCache } from '../src/routes/segment-movement.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';
const ELEVEN_MIN = 11 * 60_000; // past the 10-min fresh TTL

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

describe('segment-movement stale-on-error fallback', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let segmentId: string;
  let authHeaders: { authorization: string };
  const prevEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    prevEnv.AUTH_DISABLED = process.env.AUTH_DISABLED;
    prevEnv.JWT_SECRET = process.env.JWT_SECRET;
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;

    setDb(makeMemDb());
    __resetAccessCache();
    __clearMovementCache();
    readKpiTrendMock.mockReset();
    readMovementSeriesMock.mockReset();

    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    app = await buildApp();
    const jwt = await signAppJwt({
      sub: 'alice-sub', username: 'alice', email: 'alice@corp.com', role: 'editor',
    });
    authHeaders = { authorization: `Bearer ${jwt}` };

    const seg = await app.inject({
      method: 'POST', url: '/api/segments', headers: authHeaders,
      payload: {
        name: 'stale-test-segment', type: 'predicate', cube: 'mf_users', game_id: 'cfm_vn',
        cube_query_json: '{"dimensions":["mf_users.uid"]}',
        predicate_tree_json: '{"op":"and","children":[]}',
      },
    });
    expect(seg.statusCode).toBe(201);
    segmentId = JSON.parse(seg.body).id as string;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.AUTH_DISABLED = prevEnv.AUTH_DISABLED;
    process.env.JWT_SECRET = prevEnv.JWT_SECRET;
  });

  it('kpi-trend: after the fresh entry expires, a lakehouse error serves last-good (stale:true)', async () => {
    // Warm the cache (success → writes both fresh + :stale).
    readKpiTrendMock.mockResolvedValueOnce([{ ts: '2026-06-01', value: 1 }]);
    const warm = await app.inject({
      method: 'GET', url: `/api/segments/${segmentId}/kpi-trend`,
      headers: authHeaders, query: { from: '2026-05-20', to: '2026-06-01' },
    });
    expect(warm.statusCode).toBe(200);
    expect(JSON.parse(warm.body).stale).toBeUndefined();

    // Advance past the 10-min fresh TTL (fake Date only — JWT exp unaffected at
    // +11min). Fresh entry now expires; the :stale mirror must outlive it.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + ELEVEN_MIN);

    // Reader now throws (Trino down). Fresh key misses (expired) → catch runs →
    // cacheGetStale serves the last-good payload regardless of age.
    readKpiTrendMock.mockRejectedValue(new Error('Trino unavailable'));
    const res = await app.inject({
      method: 'GET', url: `/api/segments/${segmentId}/kpi-trend`,
      headers: authHeaders, query: { from: '2026-05-20', to: '2026-06-01' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).stale).toBe(true);
    expect(readKpiTrendMock).toHaveBeenCalledTimes(2); // warm + the throwing retry
  });

  it('movement: 502s when there is no prior success to fall back to', async () => {
    readMovementSeriesMock.mockRejectedValue(new Error('Trino unavailable'));
    const res = await app.inject({
      method: 'GET', url: `/api/segments/${segmentId}/movement`,
      headers: authHeaders, query: { from: '2026-05-20', to: '2026-06-01' },
    });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error.code).toBe('LAKEHOUSE_UNAVAILABLE');
  });
});
