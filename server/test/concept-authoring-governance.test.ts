/**
 * Phase 4 Authoring & Governance — server integration tests.
 *
 * Covers:
 *   - Role gating on glossary writes (viewer 403 / editor 200-201 / admin certify)
 *   - Role gating on POST /api/concepts/promote
 *   - Promote IDOR: segment in workspace A is 404 for workspace B request
 *   - Delete-time ref guard: 409 when a glossary term references the artifact
 *   - Segment visibility defaults to 'personal' on read
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetWorkspacesConfigCache } from '../src/services/workspaces-config-loader.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess, setWorkspaceGames } from '../src/auth/access-store-mutators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

const JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';

// ── JWT helpers ───────────────────────────────────────────────────────────────

async function viewerToken(): Promise<string> {
  return signAppJwt({ sub: 'v1', username: 'viewer', email: 'viewer@corp.com', role: 'viewer' });
}
async function editorToken(): Promise<string> {
  return signAppJwt({ sub: 'e1', username: 'editor', email: 'editor@corp.com', role: 'editor' });
}
async function adminToken(): Promise<string> {
  return signAppJwt({ sub: 'a1', username: 'admin', email: 'admin@corp.com', role: 'admin' });
}

function seedAccess(): void {
  __resetAccessCache();
  upsertUserAccess({ email: 'viewer@corp.com', role: 'viewer', status: 'active' });
  setWorkspaceGames('viewer@corp.com', 'local', ['ballistar']);
  upsertUserAccess({ email: 'editor@corp.com', role: 'editor', status: 'active' });
  setWorkspaceGames('editor@corp.com', 'local', ['ballistar']);
  upsertUserAccess({ email: 'admin@corp.com', role: 'admin', status: 'active' });
  setWorkspaceGames('admin@corp.com', 'local', ['ballistar']);
}

// ── Minimal glossary-term body ─────────────────────────────────────────────

const TERM_BODY = {
  label: 'Test Term',
  description: 'A test glossary term for authz checks',
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Phase 4 — Authoring & Governance', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prevEnv = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    __resetWorkspacesConfigCache();
    setDb(makeMemDb());
    seedAccess();
    app = await buildApp();
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prevEnv.AUTH_DISABLED;
    process.env.JWT_SECRET = prevEnv.JWT_SECRET;
    __resetWorkspacesConfigCache();
  });

  // ── C8: Viewer blocked on all glossary writes ─────────────────────────────

  it('viewer cannot POST /api/glossary (write-roles gate)', async () => {
    const token = await viewerToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/glossary',
      headers: { authorization: `Bearer ${token}` },
      payload: TERM_BODY,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error?.code).toBe('WRITE_FORBIDDEN');
  });

  it('editor CAN POST /api/glossary (creates draft)', async () => {
    const token = await editorToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/glossary',
      headers: { authorization: `Bearer ${token}` },
      payload: TERM_BODY,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('draft');
    expect(res.json().trust).toBe('draft');
  });

  // ── C8: Admin-only certify on glossary status PATCH ───────────────────────

  it('editor gets 403 on PATCH /api/glossary/:id/status (certify requires admin)', async () => {
    // First create a term as admin
    const adminTok = await adminToken();
    const create = await app.inject({
      method: 'POST',
      url: '/api/glossary',
      headers: { authorization: `Bearer ${adminTok}` },
      payload: TERM_BODY,
    });
    expect(create.statusCode).toBe(201);
    const { id } = create.json() as { id: string };

    const editorTok = await editorToken();
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/glossary/${id}/status`,
      headers: { authorization: `Bearer ${editorTok}` },
      payload: { status: 'official' },
    });
    expect(patch.statusCode).toBe(403);
  });

  it('admin CAN PATCH /api/glossary/:id/status to certify', async () => {
    const adminTok = await adminToken();
    const create = await app.inject({
      method: 'POST',
      url: '/api/glossary',
      headers: { authorization: `Bearer ${adminTok}` },
      payload: TERM_BODY,
    });
    expect(create.statusCode).toBe(201);
    const { id } = create.json() as { id: string };

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/glossary/${id}/status`,
      headers: { authorization: `Bearer ${adminTok}` },
      payload: { status: 'official' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().status).toBe('official');
  });

  // ── C8: Viewer blocked on POST /api/concepts/promote ─────────────────────

  it('viewer cannot POST /api/concepts/promote', async () => {
    const token = await viewerToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/concepts/promote',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceType: 'segment', sourceId: 'x', targetType: 'term' },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── Promote IDOR guard ────────────────────────────────────────────────────

  it('promote 404s when segment is in a different workspace', async () => {
    const editorTok = await editorToken();

    // Create a segment in workspace 'local'
    const seg = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: { authorization: `Bearer ${editorTok}`, 'x-cube-workspace': 'local' },
      payload: { name: 'Seg-A', type: 'manual' },
    });
    expect(seg.statusCode).toBe(201);
    const segId = (seg.json() as { id: string }).id;

    // Try to promote it from workspace 'prod' — should 404 (segment not in workspace)
    const promote = await app.inject({
      method: 'POST',
      url: '/api/concepts/promote',
      headers: { authorization: `Bearer ${editorTok}`, 'x-cube-workspace': 'prod' },
      payload: { sourceType: 'segment', sourceId: segId, targetType: 'term' },
    });
    expect(promote.statusCode).toBe(404);
    expect(promote.json().error?.code).toBe('NOT_FOUND');
  });

  // ── Promote happy path (editor in same workspace) ─────────────────────────

  it('editor can promote a segment to a draft term in the same workspace', async () => {
    const editorTok = await editorToken();

    const seg = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: { authorization: `Bearer ${editorTok}`, 'x-cube-workspace': 'local' },
      payload: { name: 'VIP Players', type: 'manual' },
    });
    expect(seg.statusCode).toBe(201);
    const segId = (seg.json() as { id: string }).id;

    const promote = await app.inject({
      method: 'POST',
      url: '/api/concepts/promote',
      headers: { authorization: `Bearer ${editorTok}`, 'x-cube-workspace': 'local' },
      payload: { sourceType: 'segment', sourceId: segId, targetType: 'term' },
    });
    expect(promote.statusCode).toBe(201);
    const body = promote.json() as { term?: { status: string; trust: string; secondaryCatalogIds: string[] } };
    expect(body.term).toBeDefined();
    expect(body.term?.status).toBe('draft');
    expect(body.term?.trust).toBe('draft');
    // Should include segment ref in secondary catalog ids
    expect(body.term?.secondaryCatalogIds).toContain(`segments/${segId}`);
  });

  // ── Delete-time ref guard: segment ────────────────────────────────────────

  it('deleting a segment referenced by a glossary term returns 409', async () => {
    const adminTok = await adminToken();

    // Create segment
    const seg = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: { authorization: `Bearer ${adminTok}`, 'x-cube-workspace': 'local' },
      payload: { name: 'Referenced Segment', type: 'manual' },
    });
    expect(seg.statusCode).toBe(201);
    const segId = (seg.json() as { id: string }).id;
    const segRef = `segments/${segId}`;

    // Create a glossary term that references the segment
    const term = await app.inject({
      method: 'POST',
      url: '/api/glossary',
      headers: { authorization: `Bearer ${adminTok}` },
      payload: {
        label: 'Linked Term',
        description: 'A term that points at the segment',
        secondaryCatalogIds: [segRef],
      },
    });
    expect(term.statusCode).toBe(201);

    // Now attempt to delete the segment — should be blocked
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/segments/${segId}`,
      headers: { authorization: `Bearer ${adminTok}`, 'x-cube-workspace': 'local' },
    });
    expect(del.statusCode).toBe(409);
    expect(del.json().error?.code).toBe('REF_INTEGRITY');
    const refBy = del.json().error?.referencedBy as string[];
    expect(refBy.length).toBeGreaterThan(0);
  });

  // ── Segment visibility defaults to 'personal' on read ─────────────────────

  it('segment read shape includes visibility=personal by default', async () => {
    const editorTok = await editorToken();

    const seg = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: { authorization: `Bearer ${editorTok}`, 'x-cube-workspace': 'local' },
      payload: { name: 'Vis Test', type: 'manual' },
    });
    expect(seg.statusCode).toBe(201);
    // POST returns hydrateSegment shape which now includes visibility
    expect((seg.json() as { visibility: string }).visibility).toBe('personal');

    // GET single also returns it
    const segId = (seg.json() as { id: string }).id;
    const get = await app.inject({
      method: 'GET',
      url: `/api/segments/${segId}`,
      headers: { authorization: `Bearer ${editorTok}`, 'x-cube-workspace': 'local' },
    });
    expect(get.statusCode).toBe(200);
    expect((get.json() as { visibility: string }).visibility).toBe('personal');
  });

  // ── Viewer can read glossary (GET is unprotected by write gate) ───────────

  it('viewer CAN GET /api/glossary (reads are open)', async () => {
    const token = await viewerToken();
    const res = await app.inject({
      method: 'GET',
      url: '/api/glossary',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
