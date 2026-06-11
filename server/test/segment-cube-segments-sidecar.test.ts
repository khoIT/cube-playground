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
