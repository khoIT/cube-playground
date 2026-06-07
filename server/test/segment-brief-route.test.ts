/**
 * AI brief route — cache hit/miss + hash-keyed regeneration, per-(segment,lang)
 * caching, single-flight, refresh rate-limit, error-row persistence with
 * stale-brief fallback, and guard parity (403/404 before any cache read).
 *
 * chat-service is stubbed via a global-fetch mock; assembled context still
 * runs for real (manual segments → limited coverage, no Cube calls).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, getDb, closeDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';
import { __resetBriefSingleFlight } from '../src/services/segment-brief-store.js';
import { __resetBriefRefreshState } from '../src/routes/segment-brief.js';

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

const tok = (sub: string, email: string, role: 'viewer' | 'editor' | 'admin') =>
  signAppJwt({ sub, username: sub, email, role });

const GOOD_BRIEF = {
  label: 'high_value_churn_risk',
  narrative: 'These are big spenders who have gone quiet. They drive outsized revenue. Watch for lapse.',
  signals: ['1234 members', 'LTV concentrated in top tier'],
};

describe('GET /api/segments/:id/brief', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = {
    AUTH_DISABLED: process.env.AUTH_DISABLED,
    JWT_SECRET: process.env.JWT_SECRET,
    INTERNAL_SECRET: process.env.INTERNAL_SECRET,
  };
  let aliceAuth: { authorization: string };
  let bobAuth: { authorization: string };
  let segId: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.INTERNAL_SECRET = 'test-secret';
    setDb(makeMemDb());
    __resetAccessCache();
    __resetBriefSingleFlight();
    __resetBriefRefreshState();
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    upsertUserAccess({ email: 'bob@corp.com', role: 'editor', status: 'active' });
    app = await buildApp();
    aliceAuth = { authorization: `Bearer ${await tok('alice-sub', 'alice@corp.com', 'editor')}` };
    bobAuth = { authorization: `Bearer ${await tok('bob-sub', 'bob@corp.com', 'editor')}` };

    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: aliceAuth,
      payload: { name: 'brief route seg', type: 'manual', uid_list: ['u1', 'u2'], game_id: 'ballistar' },
    });
    expect(res.statusCode).toBe(201);
    segId = res.json().id;

    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => GOOD_BRIEF,
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
    process.env.INTERNAL_SECRET = prev.INTERNAL_SECRET;
  });

  it('first GET generates + caches; second GET serves cache with NO LLM call', async () => {
    const first = await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief`, headers: aliceAuth });
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.status).toBe('ok');
    expect(body.brief.label).toBe('high_value_churn_risk');
    expect(body.brief.signals).toHaveLength(2);
    expect(body.brief.data_coverage).toBe('limited'); // manual segment, no card cache
    expect(body.brief.member_count).toBe(2);
    expect(body.brief.definition_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The outbound call carries the internal secret + assembled context.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/internal/segment-brief');
    expect((init.headers as Record<string, string>)['x-internal-secret']).toBe('test-secret');

    const second = await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief`, headers: aliceAuth });
    expect(second.statusCode).toBe(200);
    expect(second.json().brief.label).toBe('high_value_churn_risk');
    expect(fetchMock).toHaveBeenCalledTimes(1); // cache hit — no second LLM call
  });

  it('caches lang=vi independently of en and passes lang upstream', async () => {
    await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief?lang=en`, headers: aliceAuth });
    const vi_ = await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief?lang=vi`, headers: aliceAuth });
    expect(vi_.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const viBody = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(viBody.lang).toBe('vi');
    // Both rows cached side by side.
    const rows = getDb().prepare('SELECT lang FROM segment_brief_cache WHERE segment_id = ?').all(segId);
    expect(rows.map((r: { lang: string }) => r.lang).sort()).toEqual(['en', 'vi']);
  });

  it('regenerates on definition change (uid edit on manual) but NOT on rename', async () => {
    await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief`, headers: aliceAuth });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Rename — definition untouched → cache still valid.
    getDb().prepare('UPDATE segments SET name = ? WHERE id = ?').run('renamed!', segId);
    await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief`, headers: aliceAuth });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Cohort edit on a manual segment — definition moved → regenerate.
    getDb().prepare('UPDATE segments SET uid_list_json = ? WHERE id = ?').run('["u1","u2","u3"]', segId);
    const after = await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief`, headers: aliceAuth });
    expect(after.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('single-flight: concurrent opens share one generation', async () => {
    let release: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    fetchMock.mockImplementation(async () => {
      await gate;
      return { ok: true, status: 200, json: async () => GOOD_BRIEF };
    });
    const p1 = app.inject({ method: 'GET', url: `/api/segments/${segId}/brief`, headers: aliceAuth });
    const p2 = app.inject({ method: 'GET', url: `/api/segments/${segId}/brief`, headers: aliceAuth });
    await new Promise((r) => setTimeout(r, 25)); // let both reach the flight
    release!();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rate-limits ?refresh=1 to one accepted regeneration per 10 minutes', async () => {
    const first = await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief?refresh=1`, headers: aliceAuth });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief?refresh=1`, headers: aliceAuth });
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe('RATE_LIMITED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('LLM failure persists a retryable error row; next GET serves it without an LLM call', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    const fail = await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief`, headers: aliceAuth });
    expect(fail.statusCode).toBe(502);
    expect(fail.json().error.code).toBe('BRIEF_GENERATION_FAILED');

    const row = getDb()
      .prepare('SELECT status FROM segment_brief_cache WHERE segment_id = ? AND lang = ?')
      .get(segId, 'en') as { status: string };
    expect(row.status).toBe('error');

    const next = await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief`, headers: aliceAuth });
    expect(next.statusCode).toBe(200);
    expect(next.json().status).toBe('error'); // cached error row, retryable via ?refresh=1
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('upstream down after a definition change serves the previous brief marked stale', async () => {
    await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief`, headers: aliceAuth });
    getDb().prepare('UPDATE segments SET uid_list_json = ? WHERE id = ?').run('["u9"]', segId);
    fetchMock.mockImplementation(async () => { throw new Error('ECONNREFUSED'); });

    const res = await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief`, headers: aliceAuth });
    expect(res.statusCode).toBe(200);
    expect(res.json().stale).toBe(true);
    expect(res.json().brief.label).toBe('high_value_churn_risk');
  });

  it('backs off after a failed regeneration: repeat opens serve stale WITHOUT new LLM calls', async () => {
    await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief`, headers: aliceAuth });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    getDb().prepare('UPDATE segments SET uid_list_json = ? WHERE id = ?').run('["u9"]', segId);
    fetchMock.mockImplementation(async () => { throw new Error('ECONNREFUSED'); });

    const first = await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief`, headers: aliceAuth });
    expect(first.json().stale).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2); // the failed attempt

    // Outage continues: subsequent opens within the backoff window must NOT
    // re-hit the gateway — stale is served straight from the backoff branch.
    const second = await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief`, headers: aliceAuth });
    expect(second.statusCode).toBe(200);
    expect(second.json().stale).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('guards run before the cache: non-owner 403 on a personal segment, unknown 404', async () => {
    // Warm the cache as alice so a leak would have something to leak.
    await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief`, headers: aliceAuth });

    const denied = await app.inject({ method: 'GET', url: `/api/segments/${segId}/brief`, headers: bobAuth });
    expect(denied.statusCode).toBe(403);

    const unknown = await app.inject({ method: 'GET', url: '/api/segments/nope/brief', headers: aliceAuth });
    expect(unknown.statusCode).toBe(404);
  });
});
