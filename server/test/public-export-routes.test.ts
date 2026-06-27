/**
 * Phase 03/04 — public export route guards (no Trino needed).
 *
 * Covers the pre-stream surface: missing/invalid key → 401, out-of-scope
 * segment → 404 (never confirms existence), bad ?fields= → 400, manual segment
 * with no partition → 422, and the scoped metadata list/detail shapes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../src/index.js';
import { setDb, getDb, closeDb } from '../src/db/sqlite.js';
import { createKey, __resetApiKeyCaches } from '../src/auth/api-key-store.js';
import { __resetRateLimiter } from '../src/services/api-key-rate-limiter.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

function insertSegment(over: Record<string, unknown> = {}) {
  const row = {
    id: 'seg-1',
    name: 'Whales',
    type: 'manual',
    owner: 'admin@vng.com.vn',
    status: 'fresh',
    game_id: 'cfm_vn',
    workspace: 'prod',
    uid_count: 1234,
    uid_list_json: '[]',
    // Pull-path tests need a published contract: only 'served' segments are
    // pullable. Override to 'draft'/'deprecated' to test the not-served gate.
    lifecycle: 'served',
    ...over,
  };
  getDb()
    .prepare(
      `INSERT INTO segments (id, name, type, owner, status, game_id, workspace, uid_count, uid_list_json, lifecycle)
       VALUES (@id, @name, @type, @owner, @status, @game_id, @workspace, @uid_count, @uid_list_json, @lifecycle)`,
    )
    .run(row);
  return row;
}

describe('public export routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    __resetApiKeyCaches();
    __resetRateLimiter();
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
    __resetApiKeyCaches();
    __resetRateLimiter();
  });

  it('401 without a key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/public/v1/segments' });
    expect(res.statusCode).toBe(401);
  });

  it('401 with a bogus key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments',
      headers: { authorization: 'Bearer sk_live_nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('lists only scoped segments', async () => {
    insertSegment({ id: 'seg-1', workspace: 'prod' });
    insertSegment({ id: 'seg-2', workspace: 'local' }); // different workspace
    const { plaintext } = createKey({ label: 'k', workspace: 'prod', createdBy: 'admin@vng.com.vn' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments',
      headers: { authorization: `Bearer ${plaintext}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.segments.map((s: { id: string }) => s.id)).toEqual(['seg-1']);
    expect(body.segments[0].size).toBe(1234);
  });

  it('404 for an out-of-scope segment id (no existence leak)', async () => {
    insertSegment({ id: 'seg-1', workspace: 'local' });
    const { plaintext } = createKey({ label: 'k', workspace: 'prod', createdBy: 'admin@vng.com.vn' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments/seg-1',
      headers: { authorization: `Bearer ${plaintext}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('detail returns metadata + available_fields + members_url', async () => {
    insertSegment({ id: 'seg-1', workspace: 'prod' });
    const { plaintext } = createKey({ label: 'k', workspace: 'prod', createdBy: 'admin@vng.com.vn' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments/seg-1',
      headers: { authorization: `Bearer ${plaintext}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.available_fields).toEqual(['uid']);
    expect(body.members_url).toContain('/api/public/v1/segments/seg-1/members');
    expect(body.snapshot_partition_exists).toBe(false);
  });

  it('400 on an unknown ?fields= column', async () => {
    insertSegment({ id: 'seg-1', workspace: 'prod' });
    const { plaintext } = createKey({ label: 'k', workspace: 'prod', createdBy: 'admin@vng.com.vn' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments/seg-1/members?fields=ssn',
      headers: { authorization: `Bearer ${plaintext}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_FIELDS');
  });

  it('422 when a manual segment has no partition and no live predicate', async () => {
    insertSegment({ id: 'seg-1', workspace: 'prod', type: 'manual' });
    const { plaintext } = createKey({ label: 'k', workspace: 'prod', createdBy: 'admin@vng.com.vn' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments/seg-1/members',
      headers: { authorization: `Bearer ${plaintext}` },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('NO_SOURCE');
  });

  it('paginates a sparse allowlist completely (no premature null cursor)', async () => {
    // 5 segments; key allowlists the odd ones (seg-1,3,5). With limit=2 the
    // list must return all THREE across pages — the allowlist is in SQL so the
    // keyset cursor and the scope filter agree (regression: a JS-only filter on
    // a workspace-wide page would null the cursor after the first page).
    for (let i = 1; i <= 5; i++) insertSegment({ id: `seg-${i}`, workspace: 'prod' });
    const { plaintext } = createKey({
      label: 'sparse',
      workspace: 'prod',
      segmentIds: ['seg-1', 'seg-3', 'seg-5'],
      createdBy: 'admin@vng.com.vn',
    });

    const collected: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const url = `/api/public/v1/segments?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${plaintext}` } });
      const body = res.json();
      collected.push(...body.segments.map((s: { id: string }) => s.id));
      cursor = body.next_cursor;
      if (!cursor) break;
    }
    expect(collected).toEqual(['seg-1', 'seg-3', 'seg-5']);
  });

  it('segment allowlist scope denies a non-listed id', async () => {
    insertSegment({ id: 'seg-1', workspace: 'prod' });
    insertSegment({ id: 'seg-2', workspace: 'prod' });
    const { plaintext } = createKey({
      label: 'k',
      workspace: 'prod',
      segmentIds: ['seg-2'],
      createdBy: 'admin@vng.com.vn',
    });
    const list = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments',
      headers: { authorization: `Bearer ${plaintext}` },
    });
    expect(list.json().segments.map((s: { id: string }) => s.id)).toEqual(['seg-2']);

    const denied = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments/seg-1',
      headers: { authorization: `Bearer ${plaintext}` },
    });
    expect(denied.statusCode).toBe(404);
  });
});
