/**
 * Phase 5 — internal access endpoint feeding cube-dev's checkAuth.
 * Shared-secret gated; returns role+games for active users; 404 (fail-closed)
 * for unknown/inactive; 401 on bad secret; 503 when secret unset.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess, setGames } from '../src/auth/access-store-mutators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const SECRET = 'internal-shared-secret';

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

describe('GET /internal/access/:key', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = process.env.CUBE_AUTH_INTERNAL_SECRET;
  // The vitest config sets AUTH_DISABLED='true' globally; this suite exercises
  // the REAL-auth bridge (secret gate + DB resolution), so it must opt out — per
  // that config's contract ("override AUTH_DISABLED in their own beforeEach").
  const prevAuthDisabled = process.env.AUTH_DISABLED;

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.CUBE_AUTH_INTERNAL_SECRET = SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'user@corp.com', role: 'editor', status: 'active' });
    setGames('user@corp.com', ['ballistar', 'cfm_vn']);
    upsertUserAccess({ email: 'pending@corp.com', role: 'viewer', status: 'pending' });
    upsertUserAccess({ email: 'admin@corp.com', role: 'admin', status: 'active' });
    app = await buildApp();
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.CUBE_AUTH_INTERNAL_SECRET = prev;
    if (prevAuthDisabled === undefined) delete process.env.AUTH_DISABLED;
    else process.env.AUTH_DISABLED = prevAuthDisabled;
  });

  const hdr = { 'x-internal-secret': SECRET };

  it('returns role + games for active user, canonicalizing aliased ids', async () => {
    // User was granted gds.config ids ['ballistar', 'cfm_vn']. cube-dev's
    // checkAuth folds the requested game to canonical (cfm_vn → cfm) before the
    // allowedGames membership test, so the bridge must emit the canonical id —
    // else `['cfm_vn'].includes('cfm')` denies a correctly-granted user.
    const res = await app.inject({ method: 'GET', url: '/internal/access/User@Corp.com', headers: hdr });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role).toBe('editor');
    expect((body.allowedGames as string[]).sort()).toEqual(['ballistar', 'cfm']);
  });

  it('folds every aliased grant and leaves canonical ids untouched', async () => {
    setGames('user@corp.com', ['jus_vn', 'muaw', 'cfm_vn']);
    __resetAccessCache();
    const res = await app.inject({ method: 'GET', url: '/internal/access/user@corp.com', headers: hdr });
    expect((res.json().allowedGames as string[]).sort()).toEqual(['cfm', 'jus', 'muaw']);
  });

  it('resolves an admin to the all-games wildcard (no per-game rows needed)', async () => {
    // checkAuth has no grant-fallback of its own; the bridge must hand it '*'
    // (which cube-dev expands) so an admin can query every game the server allows.
    const res = await app.inject({ method: 'GET', url: '/internal/access/admin@corp.com', headers: hdr });
    expect(res.statusCode).toBe(200);
    expect(res.json().allowedGames).toEqual(['*']);
  });

  it('resolves the Playground service principal to all-games admin (no DB row)', async () => {
    // The server mints under this id for introspection / legacy token paths after
    // it has already enforced the user's access; the cube trusts it as a service
    // account. Must resolve even though no user_access row exists for it.
    const res = await app.inject({ method: 'GET', url: '/internal/access/playground', headers: hdr });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role).toBe('admin');
    expect(body.allowedGames).toEqual(['*']);
    expect(body.status).toBe('active');
  });

  it('404 (fail-closed) for pending/unknown', async () => {
    expect((await app.inject({ method: 'GET', url: '/internal/access/pending@corp.com', headers: hdr })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/internal/access/nobody@corp.com', headers: hdr })).statusCode).toBe(404);
  });

  it('401 on missing/wrong secret', async () => {
    expect((await app.inject({ method: 'GET', url: '/internal/access/user@corp.com' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/internal/access/user@corp.com', headers: { 'x-internal-secret': 'nope' } })).statusCode,
    ).toBe(401);
  });

  it('503 when secret unset', async () => {
    delete process.env.CUBE_AUTH_INTERNAL_SECRET;
    const res = await app.inject({ method: 'GET', url: '/internal/access/user@corp.com', headers: hdr });
    expect(res.statusCode).toBe(503);
  });
});
