/**
 * Multi-user / multi-workspace scoping for segments — OWNER-PRIVATE contract.
 *
 * Segments default to `personal`: only the owner (Keycloak sub) or an admin may
 * see/mutate them. `shared`/`org` are workspace-collaborative. Workspace is still
 * a hard boundary: a row in another workspace is invisible (404), never leaked.
 *
 * Dev (AUTH_DISABLED) synthesizes an admin (bypasses visibility), so this runs
 * under real auth with non-admin editors to exercise the private boundary. This
 * replaces the prior workspace-shared contract (cross-owner delete → 204), which
 * only held because the LIST never filtered on visibility.
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

const tok = (sub: string, email: string, role: 'viewer' | 'editor' | 'admin') =>
  signAppJwt({ sub, username: sub, email, role });

describe('segments — owner-private multi-user / multi-workspace scoping', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let aliceAuth: { authorization: string };
  let bobAuth: { authorization: string };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'alice@co', role: 'editor', status: 'active' });
    upsertUserAccess({ email: 'bob@co', role: 'editor', status: 'active' });
    app = await buildApp();
    aliceAuth = { authorization: `Bearer ${await tok('alice-sub', 'alice@co', 'editor')}` };
    bobAuth = { authorization: `Bearer ${await tok('bob-sub', 'bob@co', 'editor')}` };
  });

  afterEach(async () => {
    await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  async function createSegment(
    auth: { authorization: string },
    name: string,
    workspace: string,
    visibility?: string,
  ) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: { ...auth, 'x-cube-workspace': workspace },
      payload: { name, type: 'manual', ...(visibility ? { visibility } : {}) },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  function names(res: { json: () => unknown }): string[] {
    return (res.json() as Array<{ name: string }>).map((s) => s.name).sort();
  }

  it('a personal segment is private to its owner within a workspace', async () => {
    await createSegment(aliceAuth, 'alice-local', 'local');
    await createSegment(bobAuth, 'bob-local', 'local');

    // Each owner sees only their own personal segments (+ shared, none here).
    const aliceList = await app.inject({ method: 'GET', url: '/api/segments', headers: { ...aliceAuth, 'x-cube-workspace': 'local' } });
    expect(names(aliceList)).toEqual(['alice-local']);
    const bobList = await app.inject({ method: 'GET', url: '/api/segments', headers: { ...bobAuth, 'x-cube-workspace': 'local' } });
    expect(names(bobList)).toEqual(['bob-local']);
  });

  it('shared segments are visible across owners within a workspace; isolated across workspaces', async () => {
    await createSegment(aliceAuth, 'alice-shared', 'local', 'shared');
    await createSegment(aliceAuth, 'alice-prod', 'prod', 'shared');

    const local = await app.inject({ method: 'GET', url: '/api/segments', headers: { ...bobAuth, 'x-cube-workspace': 'local' } });
    expect(names(local)).toEqual(['alice-shared']); // bob sees alice's shared, not the prod one

    const prod = await app.inject({ method: 'GET', url: '/api/segments', headers: { ...bobAuth, 'x-cube-workspace': 'prod' } });
    expect(names(prod)).toEqual(['alice-prod']);
  });

  it('a different owner CANNOT delete another owner’s personal segment (403, owner-private)', async () => {
    const seg = await createSegment(aliceAuth, 'alice-local', 'local');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/segments/${seg.id}`,
      headers: { ...bobAuth, 'x-cube-workspace': 'local' },
    });
    expect(del.statusCode).toBe(403);

    // Still there for the owner.
    const after = await app.inject({ method: 'GET', url: '/api/segments', headers: { ...aliceAuth, 'x-cube-workspace': 'local' } });
    expect(names(after)).toEqual(['alice-local']);
  });

  it('treats a cross-workspace delete as not-found (never reveals other workspaces)', async () => {
    const seg = await createSegment(aliceAuth, 'alice-prod', 'prod');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/segments/${seg.id}`,
      headers: { ...aliceAuth, 'x-cube-workspace': 'local' },
    });
    expect(del.statusCode).toBe(404);

    const prod = await app.inject({ method: 'GET', url: '/api/segments', headers: { ...aliceAuth, 'x-cube-workspace': 'prod' } });
    expect(names(prod)).toEqual(['alice-prod']);
  });
});
