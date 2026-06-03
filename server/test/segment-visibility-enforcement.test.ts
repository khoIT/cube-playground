/**
 * Segment visibility enforcement — owner-private contract (real-auth mode).
 *
 * Dev (AUTH_DISABLED) synthesizes an ADMIN, which bypasses every visibility
 * check, so non-admin denial can only be exercised under real auth. This suite
 * mints app JWTs for non-admin editors (alice, bob) + an admin, seeds active
 * grants, and proves a `personal` segment is readable/mutable only by its owner
 * (sub) or an admin — on the LIST query AND every by-id route — while shared/org
 * stay workspace-collaborative.
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
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

const tok = (sub: string, email: string, role: 'viewer' | 'editor' | 'admin') =>
  signAppJwt({ sub, username: sub, email, role });

describe('segment visibility enforcement (real-auth)', () => {
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

  async function createSegment(auth: { authorization: string }, name: string, visibility?: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: auth,
      payload: { name, type: 'manual', ...(visibility ? { visibility } : {}) },
    });
    return res;
  }

  it('new segments default to personal', async () => {
    const res = await createSegment(aliceAuth, 'alice-default');
    expect(res.statusCode).toBe(201);
    expect(res.json().visibility).toBe('personal');
  });

  it('LIST: a personal segment is hidden from other users, visible to owner + admin', async () => {
    const seg = await createSegment(aliceAuth, 'alice-personal');
    const id = seg.json().id;

    const bobList = await app.inject({ method: 'GET', url: '/api/segments', headers: bobAuth });
    expect((bobList.json() as Array<{ id: string }>).some((s) => s.id === id)).toBe(false);

    const aliceList = await app.inject({ method: 'GET', url: '/api/segments', headers: aliceAuth });
    expect((aliceList.json() as Array<{ id: string }>).some((s) => s.id === id)).toBe(true);

    const adminList = await app.inject({ method: 'GET', url: '/api/segments', headers: adminAuth });
    expect((adminList.json() as Array<{ id: string }>).some((s) => s.id === id)).toBe(true);
  });

  it('LIST: a shared segment is visible to other users', async () => {
    const seg = await createSegment(aliceAuth, 'alice-shared', 'shared');
    const id = seg.json().id;
    const bobList = await app.inject({ method: 'GET', url: '/api/segments', headers: bobAuth });
    expect((bobList.json() as Array<{ id: string }>).some((s) => s.id === id)).toBe(true);
  });

  // Parametrized route-coverage: bob (editor, passes write-role gate) must be
  // denied 403 on EVERY by-id route for alice's personal segment.
  it('every by-id route 403s for a non-owner on a personal segment', async () => {
    const seg = await createSegment(aliceAuth, 'alice-personal-routes');
    const id = seg.json().id;

    const routes: Array<{ method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: unknown }> = [
      { method: 'GET', url: `/api/segments/${id}` },
      { method: 'GET', url: `/api/segments/${id}/sql-filter` },
      { method: 'GET', url: `/api/segments/${id}/refresh-log` },
      { method: 'POST', url: `/api/segments/${id}/append`, payload: { uids: ['x'] } },
      { method: 'POST', url: `/api/segments/${id}/refresh` },
      { method: 'PATCH', url: `/api/segments/${id}`, payload: { name: 'hijack' } },
      { method: 'POST', url: `/api/segments/${id}/activations`, payload: { env: 'dev', metric_name: 'm' } },
      { method: 'DELETE', url: `/api/segments/${id}/activations/abc` },
      { method: 'DELETE', url: `/api/segments/${id}` },
    ];

    for (const r of routes) {
      const res = await app.inject({ method: r.method, url: r.url, headers: bobAuth, payload: r.payload });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(403);
    }
  });

  it('owner and admin can read a personal segment by id', async () => {
    const seg = await createSegment(aliceAuth, 'alice-readable');
    const id = seg.json().id;
    const asOwner = await app.inject({ method: 'GET', url: `/api/segments/${id}`, headers: aliceAuth });
    expect(asOwner.statusCode).toBe(200);
    const asAdmin = await app.inject({ method: 'GET', url: `/api/segments/${id}`, headers: adminAuth });
    expect(asAdmin.statusCode).toBe(200);
  });

  it('a non-owner can read+mutate a SHARED segment (workspace-collaborative)', async () => {
    const seg = await createSegment(aliceAuth, 'alice-shared-rw', 'shared');
    const id = seg.json().id;
    const read = await app.inject({ method: 'GET', url: `/api/segments/${id}`, headers: bobAuth });
    expect(read.statusCode).toBe(200);
    const patch = await app.inject({ method: 'PATCH', url: `/api/segments/${id}`, headers: bobAuth, payload: { name: 'renamed' } });
    expect(patch.statusCode).toBe(200);
  });

  it("visibility 'org' is admin-only on create", async () => {
    const asEditor = await createSegment(aliceAuth, 'org-by-editor', 'org');
    expect(asEditor.statusCode).toBe(403);
    const asAdmin = await createSegment(adminAuth, 'org-by-admin', 'org');
    expect(asAdmin.statusCode).toBe(201);
    expect(asAdmin.json().visibility).toBe('org');
  });

  it("visibility 'org' is admin-only on PATCH", async () => {
    const seg = await createSegment(aliceAuth, 'to-be-org');
    const id = seg.json().id;
    const byEditor = await app.inject({ method: 'PATCH', url: `/api/segments/${id}`, headers: aliceAuth, payload: { visibility: 'org' } });
    expect(byEditor.statusCode).toBe(403);
    const byAdmin = await app.inject({ method: 'PATCH', url: `/api/segments/${id}`, headers: adminAuth, payload: { visibility: 'org' } });
    expect(byAdmin.statusCode).toBe(200);
    expect(byAdmin.json().visibility).toBe('org');
  });

  it('analyses sub-resource inherits the parent segment boundary (non-owner 403)', async () => {
    const seg = await createSegment(aliceAuth, 'alice-with-analyses');
    const id = seg.json().id;
    const analysisRoutes: Array<{ method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: unknown }> = [
      { method: 'GET', url: `/api/segments/${id}/analyses` },
      { method: 'POST', url: `/api/segments/${id}/analyses`, payload: { title: 'x' } },
      { method: 'GET', url: `/api/segments/${id}/analyses/abc` },
      { method: 'PATCH', url: `/api/segments/${id}/analyses/abc`, payload: { title: 'y' } },
      { method: 'DELETE', url: `/api/segments/${id}/analyses/abc` },
    ];
    for (const r of analysisRoutes) {
      const res = await app.inject({ method: r.method, url: r.url, headers: bobAuth, payload: r.payload });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(403);
    }
    // Owner can list analyses.
    const ok = await app.inject({ method: 'GET', url: `/api/segments/${id}/analyses`, headers: aliceAuth });
    expect(ok.statusCode).toBe(200);
  });

  it("a non-admin cannot change visibility of an 'org' segment (governance)", async () => {
    // admin creates an org segment owned by admin, then... use an org segment the
    // editor owns: admin promotes alice's segment to org, alice (owner, non-admin)
    // must not be able to downgrade it.
    const seg = await createSegment(aliceAuth, 'org-governed');
    const id = seg.json().id;
    const promote = await app.inject({ method: 'PATCH', url: `/api/segments/${id}`, headers: adminAuth, payload: { visibility: 'org' } });
    expect(promote.statusCode).toBe(200);
    const downgrade = await app.inject({ method: 'PATCH', url: `/api/segments/${id}`, headers: aliceAuth, payload: { visibility: 'shared' } });
    expect(downgrade.statusCode).toBe(403);
    // A non-visibility PATCH by the owner still works (doesn't touch org).
    const rename = await app.inject({ method: 'PATCH', url: `/api/segments/${id}`, headers: aliceAuth, payload: { name: 'renamed' } });
    expect(rename.statusCode).toBe(200);
  });

  it('owner can promote their own segment to shared (then others see it)', async () => {
    const seg = await createSegment(aliceAuth, 'promote-me');
    const id = seg.json().id;
    const patch = await app.inject({ method: 'PATCH', url: `/api/segments/${id}`, headers: aliceAuth, payload: { visibility: 'shared' } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().visibility).toBe('shared');
    const bobList = await app.inject({ method: 'GET', url: '/api/segments', headers: bobAuth });
    expect((bobList.json() as Array<{ id: string }>).some((s) => s.id === id)).toBe(true);
  });
});
