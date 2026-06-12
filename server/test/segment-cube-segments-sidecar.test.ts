/**
 * Cube-level segments (named SQL snippets like mf_users.whales) from the
 * originating playground query must survive every rebuild of cube_query_json:
 *   - create: `cube_segments` input → `segments` sidecar in cube_query_json
 *   - update: editing the predicate tree carries the sidecar forward
 * Without this, a Live segment created from a whales-scoped query silently
 * widens to all users matching the plain filters on its first refresh.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../src/index.js';
import { getDb, setDb, closeDb } from '../src/db/sqlite.js';
import { parseCubeSegments, withCubeSegments } from '../src/services/cube-query-segments.js';
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

const predicateTree = {
  kind: 'group',
  id: 'root',
  op: 'AND',
  children: [
    {
      kind: 'leaf',
      id: 'l1',
      member: 'mf_users.churn_risk',
      type: 'string',
      op: 'equals',
      values: ['at_risk'],
    },
  ],
};

function storedCubeQuery(id: string): { filters?: unknown[]; segments?: string[] } {
  const row = getDb()
    .prepare('SELECT cube_query_json FROM segments WHERE id = ?')
    .get(id) as { cube_query_json: string };
  return JSON.parse(row.cube_query_json);
}

describe('cube-segment sidecar in cube_query_json', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it('persists cube_segments from create into the stored query', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: {
        name: 'churn-risk whales',
        type: 'predicate',
        cube: 'mf_users',
        predicate_tree: predicateTree,
        cube_segments: ['mf_users.whales', 'mf_users.at_risk_paying'],
      },
    });
    expect(created.statusCode).toBe(201);
    const query = storedCubeQuery(created.json().id as string);
    expect(query.segments).toEqual(['mf_users.whales', 'mf_users.at_risk_paying']);
    expect(query.filters).toBeDefined();
  });

  it('omits the segments key when no cube_segments are sent', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: {
        name: 'plain predicate',
        type: 'predicate',
        cube: 'mf_users',
        predicate_tree: predicateTree,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(storedCubeQuery(created.json().id as string)).not.toHaveProperty('segments');
  });

  it('carries the sidecar forward when a predicate edit rebuilds the query', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: {
        name: 'whales to edit',
        type: 'predicate',
        cube: 'mf_users',
        predicate_tree: predicateTree,
        cube_segments: ['mf_users.whales'],
      },
    });
    const id = created.json().id as string;

    const editedTree = JSON.parse(JSON.stringify(predicateTree));
    editedTree.children[0].values = ['churned'];
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      payload: { predicate_tree: editedTree },
    });
    expect(patched.statusCode).toBe(200);

    const query = storedCubeQuery(id);
    expect(query.segments).toEqual(['mf_users.whales']);
    expect(JSON.stringify(query.filters)).toContain('churned');
  });
});

describe('PATCH cube_segments — precedence spec', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  async function createBase(opts: { cube_segments?: string[] } = {}): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: {
        name: 'base segment',
        type: 'predicate',
        cube: 'mf_users',
        predicate_tree: predicateTree,
        ...opts,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  it('(a) both predicate_tree + cube_segments: uses new tree + new segments, no carry-forward', async () => {
    const id = await createBase({ cube_segments: ['mf_users.old_seg'] });

    const newTree = JSON.parse(JSON.stringify(predicateTree));
    newTree.children[0].values = ['vip'];

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      payload: { predicate_tree: newTree, cube_segments: ['mf_users.whales'] },
    });
    expect(res.statusCode).toBe(200);

    const q = storedCubeQuery(id);
    expect(q.segments).toEqual(['mf_users.whales']);
    expect(JSON.stringify(q.filters)).toContain('vip');
    // old_seg is NOT carried forward when both are explicitly provided
    expect((q.segments ?? []).includes('mf_users.old_seg')).toBe(false);
  });

  it('(b) only cube_segments: rebuilds from stored tree + new segments', async () => {
    const id = await createBase({ cube_segments: ['mf_users.old_seg'] });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      payload: { cube_segments: ['mf_users.whales', 'mf_users.at_risk_paying'] },
    });
    expect(res.statusCode).toBe(200);

    const q = storedCubeQuery(id);
    // Segments updated to the new set (canonical-sorted)
    expect(q.segments).toEqual(['mf_users.at_risk_paying', 'mf_users.whales']);
    // Filters rebuilt from stored tree — still contains at_risk
    expect(JSON.stringify(q.filters)).toContain('at_risk');
  });

  it('(b) only cube_segments on segment with no stored tree returns 400', async () => {
    // Create a manual segment — no predicate_tree.
    const created = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: { name: 'manual seg', type: 'manual', cube: 'mf_users' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      payload: { cube_segments: ['mf_users.whales'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('(c) only predicate_tree: carries stored sidecar forward', async () => {
    const id = await createBase({ cube_segments: ['mf_users.whales'] });

    const newTree = JSON.parse(JSON.stringify(predicateTree));
    newTree.children[0].values = ['churned'];

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      payload: { predicate_tree: newTree },
    });
    expect(res.statusCode).toBe(200);

    const q = storedCubeQuery(id);
    // Sidecar preserved
    expect(q.segments).toEqual(['mf_users.whales']);
    // Filters updated
    expect(JSON.stringify(q.filters)).toContain('churned');
  });

  it('(d) neither tree nor segments: cube_query_json unchanged', async () => {
    const id = await createBase({ cube_segments: ['mf_users.whales'] });
    const before = storedCubeQuery(id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      payload: { name: 'renamed only' },
    });
    expect(res.statusCode).toBe(200);

    const after = storedCubeQuery(id);
    expect(after.segments).toEqual(before.segments);
    expect(JSON.stringify(after.filters)).toEqual(JSON.stringify(before.filters));
  });

  it('(d) refresh enqueues when cube_segments changed (not when unchanged)', async () => {
    // Create with no sidecar so initial status is 'refreshing' from the predicate query,
    // then manually reset to 'fresh' so we can observe the diff clearly.
    const id = await createBase();
    getDb().prepare("UPDATE segments SET status = 'fresh' WHERE id = ?").run(id);

    // Same empty sidecar as stored → should NOT flip to refreshing.
    const noop = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      payload: { cube_segments: [] },
    });
    expect(noop.statusCode).toBe(200);
    // Empty cube_segments → null (withCubeSegments no-op); stored sidecar also null/empty.
    expect(noop.json().status).toBe('fresh');

    // Different segments — SHOULD flip to refreshing.
    const changed = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      payload: { cube_segments: ['mf_users.vip'] },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().status).toBe('refreshing');
  });

  it('canonical-sorts segments before persisting to prevent byte churn', async () => {
    const id = await createBase();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      payload: { cube_segments: ['mf_users.zzz', 'mf_users.aaa', 'mf_users.mmm'] },
    });
    expect(res.statusCode).toBe(200);
    expect(storedCubeQuery(id).segments).toEqual([
      'mf_users.aaa',
      'mf_users.mmm',
      'mf_users.zzz',
    ]);
  });

  it('cube_segments is an administer-gated field (owner or admin only)', async () => {
    // Create a segment owned by the test principal (AUTH_DISABLED gives a fixed
    // sub). Then verify that patching cube_segments on it succeeds (200) — the
    // principal IS the owner, so administer-gated fields are allowed. The field
    // being in the gate means a non-owner would get 403; we test the positive
    // path since AUTH_DISABLED always runs as the owner/admin principal.
    const id = await createBase();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      payload: { cube_segments: ['mf_users.whales'] },
    });
    // The calling principal owns the segment → 200.
    expect(res.statusCode).toBe(200);
    // Confirm cube_segments reached the storage layer (not silently dropped).
    expect(storedCubeQuery(id).segments).toContain('mf_users.whales');
  });
});

describe('cube-query-segments helpers', () => {
  it('round-trips through parse + attach', () => {
    const json = JSON.stringify(withCubeSegments({ filters: [] }, ['mf_users.whales']));
    expect(parseCubeSegments(json)).toEqual(['mf_users.whales']);
  });

  it('treats empty/missing/malformed sidecars as undefined', () => {
    expect(parseCubeSegments(null)).toBeUndefined();
    expect(parseCubeSegments(JSON.stringify({ filters: [] }))).toBeUndefined();
    expect(parseCubeSegments(JSON.stringify({ segments: [] }))).toBeUndefined();
    expect(parseCubeSegments(JSON.stringify({ segments: [1, 2] }))).toBeUndefined();
    expect(parseCubeSegments('not-json')).toBeUndefined();
  });

  it('withCubeSegments is a no-op for empty input', () => {
    expect(withCubeSegments({ filters: [] }, [])).not.toHaveProperty('segments');
    expect(withCubeSegments({ filters: [] }, null)).not.toHaveProperty('segments');
  });
});
