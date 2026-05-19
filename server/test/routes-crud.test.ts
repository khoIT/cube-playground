import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const sql = readFileSync(join(__dirname, '../src/db/migrations/001-init.sql'), 'utf8');
  db.exec(sql);
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
