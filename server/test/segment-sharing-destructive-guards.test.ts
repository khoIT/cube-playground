/**
 * Segment sharing — owner/admin-only destructive set vs workspace-collaborative
 * writes (real-auth mode). Proves on a SHARED segment: non-owner DELETE /
 * visibility / predicate_tree / uid_list / append / activation-delete → 403,
 * while rename, cadence, analyses, and refresh stay open; share/unshare toggle
 * visibility + shared_at; responses carry owner_label / shared_at / is_owner.
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

describe('segment sharing destructive guards (real-auth)', () => {
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
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    upsertUserAccess({ email: 'bob@corp.com', role: 'editor', status: 'active' });
    upsertUserAccess({ email: 'admin@corp.com', role: 'admin', status: 'active' });
    app = await buildApp();
    aliceAuth = { authorization: `Bearer ${await tok('alice-sub', 'alice@corp.com', 'editor')}` };
    bobAuth = { authorization: `Bearer ${await tok('bob-sub', 'bob@corp.com', 'editor')}` };
    adminAuth = { authorization: `Bearer ${await tok('admin-sub', 'admin@corp.com', 'admin')}` };
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  /** Create a SHARED manual segment owned by alice; returns its id. */
  async function sharedSegment(name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: aliceAuth,
      payload: { name, type: 'manual', visibility: 'shared', uid_list: ['u1', 'u2'] },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  it('non-owner DELETE on a shared segment → 403; owner → 204; admin → 204', async () => {
    const id = await sharedSegment('del-guard');
    const denied = await app.inject({ method: 'DELETE', url: `/api/segments/${id}`, headers: bobAuth });
    expect(denied.statusCode).toBe(403);
    const byOwner = await app.inject({ method: 'DELETE', url: `/api/segments/${id}`, headers: aliceAuth });
    expect(byOwner.statusCode).toBe(204);

    const id2 = await sharedSegment('del-by-admin');
    const byAdmin = await app.inject({ method: 'DELETE', url: `/api/segments/${id2}`, headers: adminAuth });
    expect(byAdmin.statusCode).toBe(204);
  });

  it('non-owner PATCH of visibility / predicate_tree / uid_list → 403; rename + cadence stay open', async () => {
    const id = await sharedSegment('patch-guard');
    const destructive = [
      { visibility: 'personal' },
      { predicate_tree: { kind: 'group', id: 'g', op: 'AND', children: [] } },
      { uid_list: ['hijacked'] },
    ];
    for (const payload of destructive) {
      const res = await app.inject({ method: 'PATCH', url: `/api/segments/${id}`, headers: bobAuth, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(403);
    }
    // Collaborative fields on the SAME segment keep working for bob.
    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: bobAuth,
      payload: { name: 'renamed-by-bob', refresh_cadence_min: 60 },
    });
    expect(rename.statusCode).toBe(200);
    expect(rename.json().name).toBe('renamed-by-bob');
    // Owner can still rewrite the cohort.
    const byOwner = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: aliceAuth,
      payload: { uid_list: ['u9'] },
    });
    expect(byOwner.statusCode).toBe(200);
  });

  it('non-owner append + activation-delete → 403; owner append → 200', async () => {
    const id = await sharedSegment('append-guard');
    const denied = await app.inject({
      method: 'POST',
      url: `/api/segments/${id}/append`,
      headers: bobAuth,
      payload: { uids: ['x'] },
    });
    expect(denied.statusCode).toBe(403);
    const actDenied = await app.inject({
      method: 'DELETE',
      url: `/api/segments/${id}/activations/abc`,
      headers: bobAuth,
    });
    expect(actDenied.statusCode).toBe(403);
    const byOwner = await app.inject({
      method: 'POST',
      url: `/api/segments/${id}/append`,
      headers: aliceAuth,
      payload: { uids: ['u3'] },
    });
    expect(byOwner.statusCode).toBe(200);
    expect(byOwner.json().uid_count).toBe(3);
  });

  it('non-owner refresh + analysis creation stay open on a shared segment', async () => {
    const id = await sharedSegment('collab-writes');
    // Manual segment → refresh is 400 NOT_LIVE, NOT 403: the access guard passed.
    const refresh = await app.inject({ method: 'POST', url: `/api/segments/${id}/refresh`, headers: bobAuth });
    expect(refresh.statusCode).toBe(400);
    expect(refresh.json().error.code).toBe('NOT_LIVE');
    const analysis = await app.inject({
      method: 'POST',
      url: `/api/segments/${id}/analyses`,
      headers: bobAuth,
      payload: { title: 'bob analysis' },
    });
    expect(analysis.statusCode).toBe(201);
  });

  it('share/unshare toggle visibility + shared_at; non-owner unshare → 403', async () => {
    // alice creates personal, shares it.
    const created = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: aliceAuth,
      payload: { name: 'to-share', type: 'manual' },
    });
    const id = created.json().id;
    expect(created.json().visibility).toBe('personal');
    expect(created.json().shared_at).toBeNull();

    const shared = await app.inject({ method: 'POST', url: `/api/segments/${id}/share`, headers: aliceAuth });
    expect(shared.statusCode).toBe(200);
    expect(shared.json().visibility).toBe('shared');
    expect(shared.json().shared_at).toBeTruthy();
    expect(shared.json().is_owner).toBe(true);

    // bob (non-owner) cannot unshare or re-share.
    const bobUnshare = await app.inject({ method: 'POST', url: `/api/segments/${id}/unshare`, headers: bobAuth });
    expect(bobUnshare.statusCode).toBe(403);

    const unshared = await app.inject({ method: 'POST', url: `/api/segments/${id}/unshare`, headers: aliceAuth });
    expect(unshared.statusCode).toBe(200);
    expect(unshared.json().visibility).toBe('personal');
    expect(unshared.json().shared_at).toBeNull();
  });

  it("a non-admin owner cannot unshare an 'org' segment (governance preserved)", async () => {
    const id = await sharedSegment('org-governed');
    const promote = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: adminAuth,
      payload: { visibility: 'org' },
    });
    expect(promote.statusCode).toBe(200);
    const demote = await app.inject({ method: 'POST', url: `/api/segments/${id}/unshare`, headers: aliceAuth });
    expect(demote.statusCode).toBe(403);
    const byAdmin = await app.inject({ method: 'POST', url: `/api/segments/${id}/unshare`, headers: adminAuth });
    expect(byAdmin.statusCode).toBe(200);
    expect(byAdmin.json().visibility).toBe('personal');
  });

  it('list + detail carry owner_label / shared_at / is_owner; legacy rows degrade to sub', async () => {
    const id = await sharedSegment('serialized');
    // Legacy row: inserted directly with NULL owner_label/shared_at, in the
    // same workspace the API stamped on the created row.
    const ws = (
      getDb().prepare('SELECT workspace FROM segments WHERE id = ?').get(id) as { workspace: string }
    ).workspace;
    getDb()
      .prepare(
        `INSERT INTO segments (id, name, type, owner, status, uid_count, uid_list_json,
           created_at, updated_at, game_id, workspace, visibility)
         VALUES ('legacy-row', 'legacy', 'manual', 'alice-sub', 'fresh', 0, '[]',
           '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 'cfm', ?, 'shared')`,
      )
      .run(ws);

    const asBob = await app.inject({ method: 'GET', url: '/api/segments', headers: bobAuth });
    const list = asBob.json() as Array<Record<string, unknown>>;
    const created = list.find((s) => s.id === id)!;
    // owner_label stamped from the JWT username at create time.
    expect(created.owner_label).toBe('alice-sub');
    expect(created.is_owner).toBe(false);
    const legacy = list.find((s) => s.id === 'legacy-row')!;
    expect(legacy.owner_label).toBeNull();

    const asAlice = await app.inject({ method: 'GET', url: `/api/segments/${id}`, headers: aliceAuth });
    expect(asAlice.json().is_owner).toBe(true);
  });
});
