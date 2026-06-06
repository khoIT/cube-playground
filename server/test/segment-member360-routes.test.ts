/**
 * Member-360 cache-serving routes — guard parity with segments.ts (404
 * unknown, 403 visibility-denied under real auth) and payload shapes for the
 * panel map + per-uid status aggregate.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, getDb, closeDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';
import { upsertMember360Cache } from '../src/services/member360-cache-store.js';
import { corePanelsForGame } from '../src/services/member360-panel-registry.js';

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

describe('segment member-360 cache routes (real-auth)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let aliceAuth: { authorization: string };
  let bobAuth: { authorization: string };
  let segId: string;

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    upsertUserAccess({ email: 'bob@corp.com', role: 'editor', status: 'active' });
    app = await buildApp();
    aliceAuth = { authorization: `Bearer ${await tok('alice-sub', 'alice@corp.com', 'editor')}` };
    bobAuth = { authorization: `Bearer ${await tok('bob-sub', 'bob@corp.com', 'editor')}` };

    // Personal (default-visibility) ballistar segment owned by alice.
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: aliceAuth,
      payload: { name: 'm360 routes', type: 'manual', game_id: 'ballistar' },
    });
    expect(res.statusCode).toBe(201);
    segId = res.json().id;
    getDb().prepare('UPDATE segments SET game_id = ? WHERE id = ?').run('ballistar', segId);

    upsertMember360Cache(segId, [
      { uid: 'u1', panelId: 'profile', queryHash: 'h', rows: [{ 'user_profile.country': 'VN' }], status: 'ok' },
      { uid: 'u1', panelId: 'transactions', queryHash: 'h', rows: [], status: 'error', error: 'boom' },
      { uid: 'u2', panelId: 'profile', queryHash: 'h', rows: [{ x: 1 }], status: 'ok' },
    ]);
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  it('serves the cached panel map for an accessible member', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/segments/${segId}/members/u1/panels`,
      headers: aliceAuth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cached).toBe(true);
    expect(body.panels.profile.status).toBe('ok');
    expect(body.panels.profile.rows).toEqual([{ 'user_profile.country': 'VN' }]);
    expect(body.panels.transactions.status).toBe('error');
    expect(body.panels.transactions.error).toBe('boom');
  });

  it('returns an empty map (cached:false) for an unwarmed member — same shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/segments/${segId}/members/ghost-uid/panels`,
      headers: aliceAuth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ cached: false, panels: {} });
  });

  it('guards match segments.ts: 403 for non-owner on personal, 404 unknown', async () => {
    const denied = await app.inject({
      method: 'GET',
      url: `/api/segments/${segId}/members/u1/panels`,
      headers: bobAuth,
    });
    expect(denied.statusCode).toBe(403);

    const deniedStatus = await app.inject({
      method: 'GET',
      url: `/api/segments/${segId}/member-cache-status`,
      headers: bobAuth,
    });
    expect(deniedStatus.statusCode).toBe(403);

    const unknown = await app.inject({
      method: 'GET',
      url: '/api/segments/nope/members/u1/panels',
      headers: aliceAuth,
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('aggregates per-uid ok/error counts with the game panel_count', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/segments/${segId}/member-cache-status`,
      headers: aliceAuth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.panel_count).toBe(corePanelsForGame('ballistar').length);
    expect(body.uids.u1).toMatchObject({ ok: 1, error: 1 });
    expect(body.uids.u2).toMatchObject({ ok: 1, error: 0 });
  });
});
