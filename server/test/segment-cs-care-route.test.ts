/**
 * GET /api/segments/:id/cs-care — durable cache behavior:
 *   - cold miss builds + persists, warm hit within TTL issues zero builds,
 *   - serve-stale-on-error: a rebuild failure with a prior payload returns 200
 *     + a `stale` breadcrumb (never a 502),
 *   - true cold miss with no prior payload returns 502.
 * The payload builder is mocked; auth + segment store run for real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const buildMock = vi.fn();
vi.mock('../src/services/cs-care-builder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/cs-care-builder.js')>();
  return { ...actual, buildCsCarePayload: (...args: unknown[]) => buildMock(...args) };
});

import { buildApp } from '../src/index.js';
import { setDb, closeDb, getDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';

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

function payload(segmentId: string, tickets = 11) {
  return {
    segmentId,
    gameId: 'cfm_vn',
    productId: 1,
    coverage: { totalMembers: 50, contactedMembers: 4, pct: 8, truncated: false },
    freshness: { csMaxLogDate: '2026-06-14' },
    pulse: { tickets, contacted: 4, openUnresolved: 1, negativeSentiment: 0, lowRating: 0 },
    issueMix: [],
    watchlist: [],
    csImpact: null,
  };
}

describe('GET /api/segments/:id/cs-care', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let auth: { authorization: string };
  let predicateId: string;

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    buildMock.mockReset();
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
        name: 'cs care seg',
        type: 'predicate',
        cube: 'mf_users',
        game_id: 'cfm_vn',
        cube_query_json: '{"dimensions":["mf_users.user_id"]}',
        predicate_tree_json: '{"op":"and","children":[]}',
      },
    });
    expect(pred.statusCode).toBe(201);
    predicateId = pred.json().id;
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  it('builds on cold miss and serves a warm hit with zero rebuilds', async () => {
    buildMock.mockResolvedValue(payload(predicateId, 11));

    const first = await app.inject({ method: 'GET', url: `/api/segments/${predicateId}/cs-care`, headers: auth });
    expect(first.statusCode).toBe(200);
    expect(first.json().pulse.tickets).toBe(11);
    expect(buildMock).toHaveBeenCalledTimes(1);

    const second = await app.inject({ method: 'GET', url: `/api/segments/${predicateId}/cs-care`, headers: auth });
    expect(second.statusCode).toBe(200);
    expect(buildMock).toHaveBeenCalledTimes(1); // warm hit, no rebuild
    expect(second.json().stale).toBeUndefined();
  });

  it('serves stale-on-error when a rebuild fails after a prior success', async () => {
    buildMock.mockResolvedValueOnce(payload(predicateId, 20));
    await app.inject({ method: 'GET', url: `/api/segments/${predicateId}/cs-care`, headers: auth });

    // Age the cached row past the TTL so the next request attempts a rebuild.
    getDb()
      .prepare(`UPDATE segment_care_cache SET computed_at = ? WHERE segment_id = ?`)
      .run('2020-01-01T00:00:00.000Z', predicateId);
    buildMock.mockRejectedValueOnce(new Error('cold trino read timeout'));

    const res = await app.inject({ method: 'GET', url: `/api/segments/${predicateId}/cs-care`, headers: auth });
    expect(res.statusCode).toBe(200); // NOT 502 — last-good served
    const body = res.json();
    expect(body.pulse.tickets).toBe(20);
    expect(body.stale).toMatchObject({ reason: 'cold trino read timeout' });
    expect(body.stale.computedAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('returns 502 on a true cold miss with no prior payload', async () => {
    buildMock.mockRejectedValue(new Error('warehouse unavailable'));
    const res = await app.inject({ method: 'GET', url: `/api/segments/${predicateId}/cs-care`, headers: auth });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('CS_CARE_UNAVAILABLE');
  });
});
