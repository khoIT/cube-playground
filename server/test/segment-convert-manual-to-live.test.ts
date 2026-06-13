/**
 * Manual → predicate conversion via PATCH ("Convert to Live").
 *
 * Regression: the patch schema silently stripped `type` and the UPDATE never
 * wrote the column, so the editor showed "Segment updated" while the row
 * stayed manual — and the conversion's first refresh was never enqueued
 * because the gate checked the OLD row type.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';
import * as refreshQueue from '../src/jobs/refresh-queue.js';

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

const TREE = {
  kind: 'group',
  id: 'g',
  op: 'AND',
  children: [
    { kind: 'leaf', id: 'l1', member: 'mf_users.country', type: 'string', op: 'equals', values: ['VN'] },
  ],
};

describe('PATCH /api/segments/:id — manual → live conversion', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let ownerAuth: { authorization: string };
  let enqueueSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    // The conversion enqueues the segment's first refresh; stub it so the test
    // asserts the enqueue without spinning a real Cube-backed refresh.
    enqueueSpy = vi.spyOn(refreshQueue, 'enqueueRefresh').mockResolvedValue(undefined as never);
    app = await buildApp();
    ownerAuth = {
      authorization: `Bearer ${await signAppJwt({ sub: 'alice-sub', username: 'alice-sub', email: 'alice@corp.com', role: 'editor' })}`,
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  async function manualSegment(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: ownerAuth,
      payload: { name: 'manual-cohort', type: 'manual', cube: 'mf_users', uid_list: ['u1', 'u2'] },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  it('persists type=predicate, flips status to refreshing, and enqueues the first refresh', async () => {
    const id = await manualSegment();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { type: 'predicate', predicate_tree: TREE, refresh_cadence_min: 60 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.type).toBe('predicate');
    expect(body.status).toBe('refreshing');
    expect(enqueueSpy).toHaveBeenCalledWith(id, 'manual');

    // Survives a re-read (actually written, not just echoed).
    const reread = await app.inject({ method: 'GET', url: `/api/segments/${id}`, headers: ownerAuth });
    expect(reread.json().type).toBe('predicate');
  });

  it('rejects conversion to predicate without a tree (patch or stored)', async () => {
    const id = await manualSegment();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { type: 'predicate' },
    });
    expect(res.statusCode).toBe(400);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('predicate → manual conversion clears nothing it should not and skips refresh', async () => {
    const id = await manualSegment();
    await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { type: 'predicate', predicate_tree: TREE },
    });
    enqueueSpy.mockClear();

    const back = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { type: 'manual', predicate_tree: null, refresh_cadence_min: null },
    });
    expect(back.statusCode).toBe(200);
    expect(back.json().type).toBe('manual');
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('plain rename does not change type', async () => {
    const id = await manualSegment();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { name: 'renamed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().type).toBe('manual');
  });
});
