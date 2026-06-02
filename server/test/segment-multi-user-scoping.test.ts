/**
 * Multi-user / multi-workspace scoping for segments.
 *
 * Segments are a SHARED, workspace-scoped artifact: everyone working in a
 * workspace sees all of that workspace's segments (the FE lists with
 * owner='*'); `owner` records provenance, not a private-visibility boundary.
 * This proves the scoping holds with several owners and two workspaces — no
 * fake users are seeded into local dev to exercise it; the test creates them
 * in-memory via the X-Owner / X-Cube-Workspace headers (AUTH_DISABLED path).
 */

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
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

async function createSegment(
  app: Awaited<ReturnType<typeof buildApp>>,
  name: string,
  owner: string,
  workspace: string,
) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/segments',
    headers: { 'x-owner': owner, 'x-cube-workspace': workspace },
    payload: { name, type: 'manual' },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

function names(res: { json: () => unknown }): string[] {
  return (res.json() as Array<{ name: string }>).map((s) => s.name).sort();
}

describe('segments — multi-user / multi-workspace scoping', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it('shares segments within a workspace across owners, isolates across workspaces, and supports owner filter', async () => {
    await createSegment(app, 'alice-local', 'alice@co', 'local');
    await createSegment(app, 'bob-local', 'bob@co', 'local');
    await createSegment(app, 'alice-prod', 'alice@co', 'prod');

    // owner attributed from the authenticated identity (X-Owner here).
    const all = await app.inject({ method: 'GET', url: '/api/segments', headers: { 'x-cube-workspace': 'local' } });
    expect(all.statusCode).toBe(200);
    // Shared within the workspace: both owners' segments, but NOT the prod one.
    expect(names(all)).toEqual(['alice-local', 'bob-local']);

    // Switching workspace isolates: prod sees only its own.
    const prod = await app.inject({ method: 'GET', url: '/api/segments', headers: { 'x-cube-workspace': 'prod' } });
    expect(names(prod)).toEqual(['alice-prod']);

    // Optional owner filter narrows to one user's segments within the workspace.
    const aliceOnly = await app.inject({
      method: 'GET',
      url: '/api/segments?owner=alice@co',
      headers: { 'x-cube-workspace': 'local' },
    });
    expect(names(aliceOnly)).toEqual(['alice-local']);
  });
});
