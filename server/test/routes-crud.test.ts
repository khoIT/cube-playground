import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // Apply all migrations in order so new tables don't break older tests.
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

describe('segments CRUD routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it('POST then GET round-trips a segment with predicate_tree and populates cube_query_json', async () => {
    const predicateTree = {
      kind: 'group',
      id: 'root',
      op: 'AND',
      children: [
        { kind: 'leaf', id: 'l1', member: 'Users.country', type: 'string', op: 'equals', values: ['VN'] },
      ],
    };

    const postRes = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: {
        name: 'VN Users',
        type: 'predicate',
        cube: 'Users',
        tags: ['geo', 'vn'],
        predicate_tree: predicateTree,
      },
      headers: { 'x-owner': 'alice' },
    });

    expect(postRes.statusCode).toBe(201);
    const created = postRes.json();
    expect(created.id).toBeTruthy();
    expect(created.cube_query_json).toBeTruthy();

    const cubeQuery = JSON.parse(created.cube_query_json);
    expect(cubeQuery.filters).toHaveLength(1);
    expect(cubeQuery.filters[0]).toMatchObject({ member: 'Users.country', operator: 'equals', values: ['VN'] });

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/segments/${created.id}`,
    });

    expect(getRes.statusCode).toBe(200);
    const fetched = getRes.json();
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe('VN Users');
    expect(fetched.predicate_tree).toMatchObject(predicateTree);
  });

  it('GET returns 404 for unknown segment id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/segments/nonexistent-id',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('PATCH returns 403 when X-Owner does not match row owner', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: { name: 'Alice Segment', type: 'manual' },
      headers: { 'x-owner': 'alice' },
    });
    const { id } = postRes.json();

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      payload: { name: 'Hijacked' },
      headers: { 'x-owner': 'eve' },
    });

    expect(patchRes.statusCode).toBe(403);
    expect(patchRes.json().error.code).toBe('FORBIDDEN');
  });

  it('DELETE returns 403 when X-Owner does not match row owner', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: { name: 'Bob Segment', type: 'manual' },
      headers: { 'x-owner': 'bob' },
    });
    const { id } = postRes.json();

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/segments/${id}`,
      headers: { 'x-owner': 'mallory' },
    });

    expect(deleteRes.statusCode).toBe(403);
  });

  it('tags persist through POST and are returned on GET', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: { name: 'Tagged', type: 'manual', tags: ['alpha', 'beta', 'gamma'] },
      headers: { 'x-owner': 'carol' },
    });

    expect(postRes.statusCode).toBe(201);
    const { id } = postRes.json();

    const getRes = await app.inject({ method: 'GET', url: `/api/segments/${id}` });
    const body = getRes.json();
    expect(body.tags.sort()).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('PATCH updates tags and re-runs translator when predicate_tree changes', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: {
        name: 'Editable',
        type: 'predicate',
        predicate_tree: {
          kind: 'group', id: 'r', op: 'AND',
          children: [
            { kind: 'leaf', id: 'l1', member: 'U.x', type: 'string', op: 'equals', values: ['a'] },
          ],
        },
      },
      headers: { 'x-owner': 'dan' },
    });

    const { id } = postRes.json();

    const newTree = {
      kind: 'group', id: 'r2', op: 'AND',
      children: [
        { kind: 'leaf', id: 'l2', member: 'U.y', type: 'string', op: 'contains', values: ['foo'] },
      ],
    };

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      payload: { predicate_tree: newTree },
      headers: { 'x-owner': 'dan' },
    });

    expect(patchRes.statusCode).toBe(200);
    const patched = patchRes.json();
    const q = JSON.parse(patched.cube_query_json);
    expect(q.filters[0]).toMatchObject({ member: 'U.y', operator: 'contains', values: ['foo'] });
  });

  it('POST predicate with a warm uid_list starts at uid_count=0, status=refreshing', async () => {
    // The push-modal flow sends `uid_list` for predicate segments as a warm
    // sample from the originating playground query (capped at Cube's default
    // 10k rowLimit). Surfacing that length as the cohort size would display
    // exactly "10,000" for every large cohort until the first refresh.
    const warmSample = Array.from({ length: 10_000 }, (_, i) => `u${i}`);
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: {
        name: 'PredicateWithWarmSample',
        type: 'predicate',
        predicate_tree: {
          kind: 'group', id: 'r', op: 'AND',
          children: [
            { kind: 'leaf', id: 'l1', member: 'U.x', type: 'string', op: 'equals', values: ['a'] },
          ],
        },
        uid_list: warmSample,
      },
      headers: { 'x-owner': 'ivy' },
    });

    expect(postRes.statusCode).toBe(201);
    const created = postRes.json();
    expect(created.uid_count).toBe(0);
    expect(created.status).toBe('refreshing');
    // Warm sample is still persisted (useful for members preview); only its
    // length is no longer displayed as the cohort size.
    expect(created.uid_list ?? created.uid_list_json).toBeTruthy();
  });

  it('POST manual segment still uses uid_list.length as uid_count', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: { name: 'ManualSeg', type: 'manual', uid_list: ['u1', 'u2', 'u3'] },
      headers: { 'x-owner': 'jane' },
    });

    expect(postRes.statusCode).toBe(201);
    const created = postRes.json();
    expect(created.uid_count).toBe(3);
    expect(created.status).toBe('fresh');
  });

  it('PATCH with predicate_tree preserves uid_count and flips status to refreshing', async () => {
    // Seed a predicate segment with a synthetic uid_count to simulate a
    // previously-refreshed cohort. Inserts directly so we control the size
    // independently of the (mock-less) refresh job.
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: {
        name: 'WithCohort',
        type: 'predicate',
        predicate_tree: {
          kind: 'group', id: 'r', op: 'AND',
          children: [
            { kind: 'leaf', id: 'l1', member: 'U.x', type: 'string', op: 'equals', values: ['a'] },
          ],
        },
      },
      headers: { 'x-owner': 'grace' },
    });
    const { id } = postRes.json();

    // Simulate prior refresh state — true count 214_072, list capped at 100k.
    const { getDb } = await import('../src/db/sqlite.js');
    const sampleList = JSON.stringify(Array.from({ length: 100_000 }, (_, i) => `u${i}`));
    getDb()
      .prepare('UPDATE segments SET uid_count = ?, uid_list_json = ?, status = ? WHERE id = ?')
      .run(214_072, sampleList, 'fresh', id);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      payload: {
        predicate_tree: {
          kind: 'group', id: 'r2', op: 'AND',
          children: [
            { kind: 'leaf', id: 'l2', member: 'U.y', type: 'string', op: 'equals', values: ['b'] },
          ],
        },
      },
      headers: { 'x-owner': 'grace' },
    });

    expect(patchRes.statusCode).toBe(200);
    const patched = patchRes.json();
    // uid_count is NOT silently overwritten with the truncated-list length.
    expect(patched.uid_count).toBe(214_072);
    // Status flips to refreshing so the UI shows in-flight; the queued
    // refresh job will materialize the fresh count.
    expect(patched.status).toBe('refreshing');
  });

  it('PATCH metadata-only (name) leaves uid_count and status untouched', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: {
        name: 'NameOnly',
        type: 'predicate',
        predicate_tree: {
          kind: 'group', id: 'r', op: 'AND',
          children: [
            { kind: 'leaf', id: 'l1', member: 'U.x', type: 'string', op: 'equals', values: ['a'] },
          ],
        },
      },
      headers: { 'x-owner': 'henry' },
    });
    const { id } = postRes.json();

    const { getDb } = await import('../src/db/sqlite.js');
    getDb()
      .prepare('UPDATE segments SET uid_count = ?, status = ? WHERE id = ?')
      .run(42_000, 'fresh', id);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      payload: { name: 'Renamed' },
      headers: { 'x-owner': 'henry' },
    });

    expect(patchRes.statusCode).toBe(200);
    const patched = patchRes.json();
    expect(patched.name).toBe('Renamed');
    expect(patched.uid_count).toBe(42_000);
    expect(patched.status).toBe('fresh');
  });

  it('POST /append de-duplicates uid list and updates uid_count', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: { name: 'AppendSeg', type: 'manual', uid_list: ['u1', 'u2'] },
      headers: { 'x-owner': 'eve' },
    });
    const { id } = postRes.json();

    const appendRes = await app.inject({
      method: 'POST',
      url: `/api/segments/${id}/append`,
      payload: { uids: ['u2', 'u3', 'u4'] },
      headers: { 'x-owner': 'eve' },
    });

    expect(appendRes.statusCode).toBe(200);
    expect(appendRes.json().uid_count).toBe(4);
  });

  it('POST /refresh returns 202 and sets status to refreshing', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: { name: 'RefreshSeg', type: 'predicate' },
      headers: { 'x-owner': 'frank' },
    });
    const { id } = postRes.json();

    const refreshRes = await app.inject({
      method: 'POST',
      url: `/api/segments/${id}/refresh`,
      headers: { 'x-owner': 'frank' },
    });

    expect(refreshRes.statusCode).toBe(202);
    expect(refreshRes.json().status).toBe('refreshing');
  });
});
