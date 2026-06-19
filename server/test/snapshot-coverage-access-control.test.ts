/**
 * HTTP-level access-control + routing tests for the fleet snapshot-coverage and
 * per-segment snapshot-ledger endpoints.
 *
 * The fleet endpoint must replicate the GET /api/segments visibility guard so a
 * non-admin never sees another owner's personal segments, and its result cache
 * must be keyed per-principal so one caller can't read another's fleet. These
 * paths are security-critical and guarded only by hand-written SQL, so they get
 * direct route coverage here.
 *
 * The lakehouse reader is mocked to return no captures: the access-control and
 * routing logic live entirely in SQLite + the route, so we isolate them from
 * Trino (absent in CI) and assert the SQLite visibility filtering directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Mock the lakehouse reader so the fleet route never touches Trino. The
// per-segment ledger reader is mocked too, but the ledger tests here exercise
// only pre-reader guards (validation / 404), so the stub is never reached there.
vi.mock('../src/lakehouse/segment-movement-reader.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/lakehouse/segment-movement-reader.js')>();
  return {
    ...actual,
    readSnapshotCoverageTimestamps: vi.fn(async () => []),
    readSnapshotLedger: vi.fn(async () => []),
  };
});

import { buildApp } from '../src/index.js';
import { setDb, closeDb, getDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';
import { __clearMovementCache } from '../src/routes/segment-movement.js';

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

describe('GET /api/segments/snapshot-coverage — access control', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let aliceAuth: { authorization: string };
  let bobAuth: { authorization: string };
  let adminAuth: { authorization: string };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    __clearMovementCache(); // module-level cache persists across tests in a file
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    upsertUserAccess({ email: 'bob@corp.com', role: 'editor', status: 'active' });
    upsertUserAccess({ email: 'admin@corp.com', role: 'admin', status: 'active' });
    app = await buildApp();
    aliceAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'alice-sub', username: 'alice-sub', email: 'alice@corp.com', role: 'editor' })}` };
    bobAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'bob-sub', username: 'bob-sub', email: 'bob@corp.com', role: 'editor' })}` };
    adminAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'admin-sub', username: 'admin-sub', email: 'admin@corp.com', role: 'admin' })}` };
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  async function makePredicate(
    auth: { authorization: string },
    name: string,
    visibility: 'personal' | 'shared',
  ): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: auth,
      payload: { name, type: 'predicate', game_id: 'cfm_vn', predicate_tree: { op: 'and', children: [] }, visibility },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  function names(body: { rows: Array<{ name: string }> }): string[] {
    return body.rows.map((r) => r.name).sort();
  }

  it('non-admin sees own (personal+shared) and others’ shared, NOT others’ personal', async () => {
    await makePredicate(aliceAuth, 'alice-personal', 'personal');
    await makePredicate(aliceAuth, 'alice-shared', 'shared');
    await makePredicate(bobAuth, 'bob-personal', 'personal');
    await makePredicate(bobAuth, 'bob-shared', 'shared');

    const res = await app.inject({ method: 'GET', url: '/api/segments/snapshot-coverage', headers: aliceAuth });
    expect(res.statusCode).toBe(200);
    // alice's two + bob's shared; bob-personal is hidden.
    expect(names(res.json())).toEqual(['alice-personal', 'alice-shared', 'bob-shared']);
  });

  it('admin sees every segment', async () => {
    await makePredicate(aliceAuth, 'alice-personal', 'personal');
    await makePredicate(bobAuth, 'bob-personal', 'personal');

    const res = await app.inject({ method: 'GET', url: '/api/segments/snapshot-coverage', headers: adminAuth });
    expect(res.statusCode).toBe(200);
    expect(names(res.json())).toEqual(['alice-personal', 'bob-personal']);
  });

  it('cache is keyed per-principal — bob does not get alice’s cached fleet', async () => {
    await makePredicate(aliceAuth, 'alice-personal', 'personal');
    await makePredicate(bobAuth, 'bob-personal', 'personal');

    // Alice primes the cache first.
    const a = await app.inject({ method: 'GET', url: '/api/segments/snapshot-coverage', headers: aliceAuth });
    expect(names(a.json())).toEqual(['alice-personal']);
    // Bob must NOT receive alice's cached payload.
    const b = await app.inject({ method: 'GET', url: '/api/segments/snapshot-coverage', headers: bobAuth });
    expect(names(b.json())).toEqual(['bob-personal']);
  });

  it('rows carry trackCadence + game and empty coverage when no captures exist', async () => {
    await makePredicate(aliceAuth, 'alice-personal', 'personal');
    const res = await app.inject({ method: 'GET', url: '/api/segments/snapshot-coverage', headers: aliceAuth });
    const row = res.json().rows[0];
    expect(row.trackCadence).toBe('daily');
    expect(row.gameId).toBe('cfm_vn');
    expect(row.grains).toEqual([]);
    expect(row.depthDays).toBe(0);
    expect(row.lastSnapshotTs).toBeNull();
  });
});

describe('GET /api/segments/:id/snapshot-ledger — guards', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let auth: { authorization: string };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    __clearMovementCache();
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    app = await buildApp();
    auth = { authorization: `Bearer ${await signAppJwt({ sub: 'alice-sub', username: 'alice-sub', email: 'alice@corp.com', role: 'editor' })}` };
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  async function makeWithGame(): Promise<string> {
    const created = await app.inject({
      method: 'POST', url: '/api/segments', headers: auth,
      payload: { name: 'with-game', type: 'predicate', game_id: 'cfm_vn', predicate_tree: { op: 'and', children: [] } },
    });
    expect(created.statusCode).toBe(201);
    return created.json().id as string;
  }

  it('404s NO_GAME when a segment has no game_id', async () => {
    const id = await makeWithGame();
    // game_id is NOT NULL in the schema; force the no-game branch via direct write.
    getDb().prepare("UPDATE segments SET game_id = '' WHERE id = ?").run(id);
    const res = await app.inject({ method: 'GET', url: `/api/segments/${id}/snapshot-ledger`, headers: auth });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NO_GAME');
  });

  it('400s on a malformed date before any lakehouse call', async () => {
    const id = await makeWithGame();
    const res = await app.inject({
      method: 'GET', url: `/api/segments/${id}/snapshot-ledger?from=not-a-date&to=2026-06-01`, headers: auth,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_DATE_RANGE');
  });

  it('404s for an unknown segment id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/segments/does-not-exist/snapshot-ledger', headers: auth });
    expect(res.statusCode).toBe(404);
  });
});
