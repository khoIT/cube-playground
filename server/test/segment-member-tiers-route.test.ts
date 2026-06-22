/**
 * GET /api/segments/:id/member-tiers — live "paying users only" tiers route:
 *   - scope must be `paying` (default tiers ship inline → 400 otherwise),
 *   - cold miss computes once, warm hit within TTL recomputes zero times,
 *   - a compute failure surfaces 502 (no durable serve-stale for the sub-scope).
 * The tier compute is mocked; auth + segment store run for real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const tiersMock = vi.fn();
vi.mock('../src/services/segment-paying-tiers.js', () => ({
  computePayingMemberTiers: (...args: unknown[]) => tiersMock(...args),
}));

import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';
import { __clearPayingTiersCache } from '../src/routes/segment-member-tiers.js';

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

const tiersPayload = {
  computed_at: '2026-06-23T00:00:00.000Z',
  ltv_measure: 'mf_users.ingame_total_recharge_value_vnd',
  tiers: { top: [{ uid: 'u1', ltv: 9_000_000 }], bottom: [{ uid: 'u2', ltv: 10_000 }] },
};

describe('GET /api/segments/:id/member-tiers', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let auth: { authorization: string };
  let segId: string;

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    __clearPayingTiersCache();
    tiersMock.mockReset();
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    app = await buildApp();
    auth = {
      authorization: `Bearer ${await signAppJwt({ sub: 'alice-sub', username: 'alice', email: 'alice@corp.com', role: 'editor' })}`,
    };
    const seg = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: auth,
      payload: {
        name: 'tiers seg',
        type: 'predicate',
        cube: 'mf_users',
        game_id: 'cfm_vn',
        cube_query_json: '{"dimensions":["mf_users.user_id"]}',
        predicate_tree_json: '{"op":"and","children":[]}',
      },
    });
    expect(seg.statusCode).toBe(201);
    segId = seg.json().id;
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  it('rejects a non-paying scope (default tiers ship inline)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/segments/${segId}/member-tiers`, headers: auth });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('UNSUPPORTED_SCOPE');
    expect(tiersMock).not.toHaveBeenCalled();
  });

  it('computes paying tiers on cold miss and serves a warm hit', async () => {
    tiersMock.mockResolvedValue(tiersPayload);

    const first = await app.inject({ method: 'GET', url: `/api/segments/${segId}/member-tiers?scope=paying`, headers: auth });
    expect(first.statusCode).toBe(200);
    // Response is { tiers: MemberTiers }; MemberTiers itself has a `.tiers` map.
    expect(first.json().tiers.tiers.top[0].uid).toBe('u1');
    expect(tiersMock).toHaveBeenCalledTimes(1);

    const second = await app.inject({ method: 'GET', url: `/api/segments/${segId}/member-tiers?scope=paying`, headers: auth });
    expect(second.statusCode).toBe(200);
    expect(tiersMock).toHaveBeenCalledTimes(1); // warm hit, no recompute
  });

  it('returns {tiers:null} when the sub-scope does not apply', async () => {
    tiersMock.mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: `/api/segments/${segId}/member-tiers?scope=paying`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().tiers).toBeNull();
  });

  it('returns 502 when the live compute throws', async () => {
    tiersMock.mockRejectedValue(new Error('cold trino read timeout'));
    const res = await app.inject({ method: 'GET', url: `/api/segments/${segId}/member-tiers?scope=paying`, headers: auth });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('PAYING_TIERS_UNAVAILABLE');
  });
});
