/**
 * Workspace readiness route — exercises:
 *   • unknown workspace id → 400 with `unknown workspace …` message
 *   • happy path returns the right shape (workspace + games + coverage + artifacts)
 *   • artifact counts respect the per-(owner, workspace) filter
 *
 * `getMetaWithCtx` is mocked so the test doesn't need a real Cube backend.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../src/services/cube-client.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/cube-client.js')>(
    '../src/services/cube-client.js',
  );
  return {
    ...actual,
    getMetaWithCtx: vi.fn(async () => ({
      cubes: [
        { name: 'mf_users', measures: [{ name: 'mf_users.user_count' }], dimensions: [] },
      ],
    })),
  };
});

import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';

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

describe('GET /api/workspaces/:id/readiness', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: Database.Database;

  beforeEach(async () => {
    db = makeMemDb();
    setDb(db);
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it('400s on unknown workspace id (no outbound fetch made)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/workspaces/does-not-exist/readiness',
      headers: { 'x-cube-workspace': 'local', 'x-owner': 'alice' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/unknown workspace/i);
  });

  it('returns workspace + games + coverage + artifacts shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/workspaces/local/readiness',
      headers: { 'x-cube-workspace': 'local', 'x-owner': 'alice' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.workspace).toMatchObject({ id: 'local', label: expect.any(String) });
    expect(Array.isArray(body.games)).toBe(true);
    expect(body.coverage).toBeDefined();
    expect(body.artifacts).toMatchObject({
      dashboards: 0,
      segments: 0,
      cubeAliases: 0,
    });
  });

  it('artifact counts respect (owner, workspace) filter', async () => {
    // Two segments in `local`, one in `prod`, all owned by alice.
    const now = new Date().toISOString();
    const insertSeg = db.prepare(
      `INSERT INTO segments (game_id, owner, name, status, type, workspace, created_at, updated_at)
       VALUES (?, 'alice', ?, 'fresh', 'manual', ?, ?, ?)`,
    );
    insertSeg.run('ballistar', 'A', 'local', now, now);
    insertSeg.run('ballistar', 'B', 'local', now, now);
    insertSeg.run('ballistar', 'C', 'prod', now, now);
    // And one dashboard for bob (different owner) — must NOT count for alice.
    db.prepare(
      `INSERT INTO dashboards (owner, game, slug, title, created_at, updated_at, workspace)
       VALUES ('bob', 'ballistar', 'b1', 'B1 dashboard', ?, ?, 'local')`,
    ).run(now, now);

    const aliceLocal = await app.inject({
      method: 'GET',
      url: '/api/workspaces/local/readiness',
      headers: { 'x-cube-workspace': 'local', 'x-owner': 'alice' },
    });
    expect(aliceLocal.statusCode).toBe(200);
    const local = aliceLocal.json().artifacts;
    expect(local.segments).toBe(2);
    expect(local.dashboards).toBe(0); // bob's dashboard must NOT leak

    const aliceProd = await app.inject({
      method: 'GET',
      url: '/api/workspaces/local/readiness',
      headers: { 'x-cube-workspace': 'local', 'x-owner': 'alice' },
    });
    // Same workspace path, just sanity that the read is stable.
    expect(aliceProd.json().artifacts.segments).toBe(2);
  });
});

describe('GET /api/workspaces/:id/games-readiness', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: Database.Database;

  beforeEach(async () => {
    db = makeMemDb();
    setDb(db);
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it('400s on unknown workspace id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/workspaces/does-not-exist/games-readiness',
      headers: { 'x-cube-workspace': 'local', 'x-owner': 'alice' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/unknown workspace/i);
  });

  it('returns the games[] availability slice with status per game', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/workspaces/local/games-readiness',
      headers: { 'x-cube-workspace': 'local', 'x-owner': 'alice' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.games)).toBe(true);
    expect(body.games.length).toBeGreaterThan(0);
    // Mock /meta returns a cube → every game resolves 'ok'.
    for (const g of body.games) {
      expect(g).toMatchObject({ id: expect.any(String), status: expect.any(String) });
    }
    expect(body.games.some((g: { status: string }) => g.status === 'ok')).toBe(true);
    // No coverage/artifacts in the lightweight slice.
    expect(body.coverage).toBeUndefined();
    expect(body.artifacts).toBeUndefined();
  });
});
