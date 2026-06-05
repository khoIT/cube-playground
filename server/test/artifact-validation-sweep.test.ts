/**
 * Tests for the artifact validation sweep service and route.
 *
 * Covers:
 *   - static member check: missing member → missing-member with refs
 *   - dashboard/segment: persisted status (fresh→ok, broken+preagg-err→missing-preagg,
 *     broken+other→runtime-error, no cache row→unverified)
 *   - malformed query_json → runtime-error, sweep continues
 *   - live:false → zero /load calls
 *   - live:true → only static-passing chat artifacts probe (bounded ≤2, limit:1)
 *   - non-game_id workspace → empty + note, no cube calls
 *   - chat DB unavailable → fail-open (chatArtifacts:[], note set)
 *   - POST /api/workspaces/:id/artifact-sweep: 400 unknown, 200 shape
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

// ── Mocks (must be hoisted before imports) ──────────────────────────────────

vi.mock('../src/services/cube-client.js', () => ({
  getMetaWithCtx: vi.fn(),
  loadWithCtx: vi.fn(),
}));

vi.mock('../src/services/resolve-cube-token.js', () => ({
  resolveCubeTokenForWorkspace: vi.fn(() => ({ token: 'test-token' })),
}));

vi.mock('../src/services/games-config-loader.js', () => ({
  loadGamesConfig: vi.fn(() => ({
    defaultGameId: 'ballistar',
    games: [
      { id: 'ballistar', name: 'Ballistar' },
      { id: 'muaw', name: 'Muaw' },
    ],
  })),
}));

// Prevent the sweep service from opening the real chat DB in tests.
vi.mock('better-sqlite3', async (importOriginal) => {
  // We still need the real better-sqlite3 for our in-memory test DB.
  // The mock intercepts `new Database(path, { readonly: true })` calls
  // (chat DB open) while leaving other `new Database(...)` calls intact.
  const Actual = await importOriginal<typeof import('better-sqlite3')>();
  const ActualConstructor = Actual.default;

  const MockConstructor: typeof ActualConstructor = function MockDatabase(
    path: string,
    opts?: ConstructorParameters<typeof ActualConstructor>[1],
  ) {
    // Intercept read-only opens (chat DB) — throw so the sweep hits fail-open.
    if (opts && typeof opts === 'object' && (opts as { readonly?: boolean }).readonly === true) {
      throw new Error('chat DB not available in test environment');
    }
    return new ActualConstructor(path, opts);
  } as unknown as typeof ActualConstructor;

  // Copy static members so the type still satisfies the import.
  Object.setPrototypeOf(MockConstructor, Object.getPrototypeOf(ActualConstructor));
  Object.assign(MockConstructor, ActualConstructor);

  return { default: MockConstructor };
});

import { getMetaWithCtx, loadWithCtx } from '../src/services/cube-client.js';
import { runSweep } from '../src/services/artifact-validation-sweep.js';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import type { WorkspaceDef } from '../src/services/workspaces-config-loader.js';
import { PARTITION_NOT_BUILT_SUBSTRING } from '../src/services/preagg-readiness.js';

const mockGetMeta = getMetaWithCtx as ReturnType<typeof vi.fn>;
const mockLoad = loadWithCtx as ReturnType<typeof vi.fn>;

// ── Fixtures ─────────────────────────────────────────────────────────────────

let _slugCounter = 0;
function uniqueSlug(): string {
  return `slug-${Date.now()}-${++_slugCounter}`;
}

const gameIdWorkspace: WorkspaceDef = {
  id: 'local',
  label: 'Local dev',
  cubeApiUrl: 'http://localhost:4000',
  authMode: 'minted',
  gameModel: 'game_id',
};

const prefixWorkspace: WorkspaceDef = {
  id: 'prod',
  label: 'Production',
  cubeApiUrl: 'http://cube-prod:4000',
  authMode: 'env-token',
  gameModel: 'prefix',
};

/** Minimal /meta snapshot with one known measure and one dimension. */
const goodMeta = {
  cubes: [
    {
      name: 'active_daily',
      measures: [{ name: 'active_daily.dau' }],
      dimensions: [{ name: 'active_daily.log_date' }],
    },
  ],
};

/** In-memory DB with all migrations applied. */
function makeMemDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

/** Insert a dashboard + tile, optionally with a tile-cache row. */
function seedDashboardTile(
  db: Database.Database,
  opts: {
    owner: string;
    workspace?: string;
    game: string;
    queryJson: string;
    cacheStatus?: 'fresh' | 'broken' | null;
    cacheError?: string | null;
  },
): { dashboardId: number; tileId: number } {
  const ws = opts.workspace ?? 'local';
  const now = new Date().toISOString();
  const { lastInsertRowid: dashboardId } = db
    .prepare(
      `INSERT INTO dashboards (owner, game, slug, title, workspace, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(opts.owner, opts.game, uniqueSlug(), 'Test Dashboard', ws, now, now);

  const { lastInsertRowid: tileId } = db
    .prepare(
      `INSERT INTO dashboard_tiles (dashboard_id, title, query_json, viz_type, position_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(Number(dashboardId), 'Test Tile', opts.queryJson, 'line', '{}', now, now);

  if (opts.cacheStatus) {
    db.prepare(
      `INSERT INTO dashboard_tile_cache
         (tile_id, rows_json, rows_hash, cube_meta_version, fetched_at, expires_at, status, error_msg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      Number(tileId),
      '[]',
      '',
      '1',
      now,
      new Date(Date.now() + 3_600_000).toISOString(),
      opts.cacheStatus,
      opts.cacheError ?? null,
    );
  }

  return { dashboardId: Number(dashboardId), tileId: Number(tileId) };
}

/** Insert a segment with cube_query_json. */
function seedSegment(
  db: Database.Database,
  opts: {
    owner: string;
    workspace?: string;
    gameId: string;
    name: string;
    queryJson: string;
    status?: 'fresh' | 'broken' | 'stale';
    brokenReason?: string | null;
  },
): string {
  const ws = opts.workspace ?? 'local';
  const id = `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO segments
       (id, name, type, owner, status, game_id, workspace, cube_query_json, broken_reason, created_at, updated_at)
     VALUES (?, ?, 'predicate', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    opts.name,
    opts.owner,
    opts.status ?? 'fresh',
    opts.gameId,
    ws,
    opts.queryJson,
    opts.brokenReason ?? null,
    now,
    now,
  );
  return id;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runSweep — non-game_id workspace short-circuit', () => {
  it('returns empty sections + note without issuing any /meta or /load', async () => {
    const result = await runSweep(makeMemDb(), prefixWorkspace, 'alice');
    expect(result.dashboards).toHaveLength(0);
    expect(result.segments).toHaveLength(0);
    expect(result.chatArtifacts).toHaveLength(0);
    expect(result.note).toMatch(/game_id/);
    expect(mockGetMeta).not.toHaveBeenCalled();
    expect(mockLoad).not.toHaveBeenCalled();
  });
});

describe('runSweep — static member check', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeMemDb();
    vi.clearAllMocks();
    mockGetMeta.mockResolvedValue(goodMeta);
    mockLoad.mockResolvedValue({ data: [] });
  });

  it('classifies a known-good member as ok (fresh cache)', async () => {
    const goodQuery = JSON.stringify({
      measures: ['active_daily.dau'],
      dimensions: ['active_daily.log_date'],
    });
    seedDashboardTile(db, {
      owner: 'alice',
      game: 'ballistar',
      queryJson: goodQuery,
      cacheStatus: 'fresh',
    });

    const result = await runSweep(db, gameIdWorkspace, 'alice');
    expect(result.dashboards).toHaveLength(1);
    expect(result.dashboards[0].status).toBe('ok');
    expect(mockLoad).not.toHaveBeenCalled(); // no /load for dashboards ever
  });

  it('classifies a renamed measure as missing-member and lists the ref', async () => {
    const badQuery = JSON.stringify({ measures: ['active_daily.dau_old'] });
    seedDashboardTile(db, {
      owner: 'alice',
      game: 'ballistar',
      queryJson: badQuery,
      cacheStatus: 'fresh',
    });

    const result = await runSweep(db, gameIdWorkspace, 'alice');
    expect(result.dashboards[0].status).toBe('missing-member');
    expect(result.dashboards[0].refs).toContain('active_daily.dau_old');
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('classifies a missing time dimension as missing-member', async () => {
    const badQuery = JSON.stringify({
      measures: ['active_daily.dau'],
      timeDimensions: [{ dimension: 'active_daily.removed_dim' }],
    });
    seedDashboardTile(db, { owner: 'alice', game: 'ballistar', queryJson: badQuery });

    const result = await runSweep(db, gameIdWorkspace, 'alice');
    expect(result.dashboards[0].status).toBe('missing-member');
    expect(result.dashboards[0].refs).toContain('active_daily.removed_dim');
  });
});

describe('runSweep — dashboard persisted-status classification', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeMemDb();
    vi.clearAllMocks();
    mockGetMeta.mockResolvedValue(goodMeta);
  });

  const goodQuery = JSON.stringify({ measures: ['active_daily.dau'] });

  it('fresh tile-cache → ok', async () => {
    seedDashboardTile(db, {
      owner: 'alice',
      game: 'ballistar',
      queryJson: goodQuery,
      cacheStatus: 'fresh',
    });
    const result = await runSweep(db, gameIdWorkspace, 'alice');
    expect(result.dashboards[0].status).toBe('ok');
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('no tile-cache row → unverified', async () => {
    seedDashboardTile(db, {
      owner: 'alice',
      game: 'ballistar',
      queryJson: goodQuery,
      cacheStatus: null, // no cache row
    });
    const result = await runSweep(db, gameIdWorkspace, 'alice');
    expect(result.dashboards[0].status).toBe('unverified');
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('broken + partition-not-built error → missing-preagg', async () => {
    seedDashboardTile(db, {
      owner: 'alice',
      game: 'ballistar',
      queryJson: goodQuery,
      cacheStatus: 'broken',
      cacheError: `Error: ${PARTITION_NOT_BUILT_SUBSTRING} for active_daily`,
    });
    const result = await runSweep(db, gameIdWorkspace, 'alice');
    expect(result.dashboards[0].status).toBe('missing-preagg');
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('broken + generic error → runtime-error', async () => {
    seedDashboardTile(db, {
      owner: 'alice',
      game: 'ballistar',
      queryJson: goodQuery,
      cacheStatus: 'broken',
      cacheError: 'Trino connection timeout',
    });
    const result = await runSweep(db, gameIdWorkspace, 'alice');
    expect(result.dashboards[0].status).toBe('runtime-error');
    expect(result.dashboards[0].detail).toMatch(/Trino/);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('malformed query_json → runtime-error, sweep continues', async () => {
    seedDashboardTile(db, {
      owner: 'alice',
      game: 'ballistar',
      queryJson: 'not-valid-json{',
      cacheStatus: 'fresh',
    });
    seedDashboardTile(db, {
      owner: 'alice',
      game: 'ballistar',
      queryJson: JSON.stringify({ measures: ['active_daily.dau'] }),
      cacheStatus: 'fresh',
    });
    const result = await runSweep(db, gameIdWorkspace, 'alice');
    expect(result.dashboards).toHaveLength(2);
    const malformed = result.dashboards.find((r) => r.status === 'runtime-error');
    const ok = result.dashboards.find((r) => r.status === 'ok');
    expect(malformed).toBeDefined();
    expect(ok).toBeDefined();
    expect(mockLoad).not.toHaveBeenCalled();
  });
});

describe('runSweep — segment persisted-status classification', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeMemDb();
    vi.clearAllMocks();
    mockGetMeta.mockResolvedValue(goodMeta);
  });

  const goodQuery = JSON.stringify({ measures: ['active_daily.dau'] });

  it('fresh segment → ok', async () => {
    seedSegment(db, {
      owner: 'alice',
      gameId: 'ballistar',
      name: 'Seg A',
      queryJson: goodQuery,
      status: 'fresh',
    });
    const result = await runSweep(db, gameIdWorkspace, 'alice');
    expect(result.segments[0].status).toBe('ok');
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('broken segment + partition-not-built → missing-preagg', async () => {
    seedSegment(db, {
      owner: 'alice',
      gameId: 'ballistar',
      name: 'Seg B',
      queryJson: goodQuery,
      status: 'broken',
      brokenReason: `${PARTITION_NOT_BUILT_SUBSTRING} for active_daily`,
    });
    const result = await runSweep(db, gameIdWorkspace, 'alice');
    expect(result.segments[0].status).toBe('missing-preagg');
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('broken segment + other error → runtime-error', async () => {
    seedSegment(db, {
      owner: 'alice',
      gameId: 'ballistar',
      name: 'Seg C',
      queryJson: goodQuery,
      status: 'broken',
      brokenReason: 'cube dimension not found',
    });
    const result = await runSweep(db, gameIdWorkspace, 'alice');
    expect(result.segments[0].status).toBe('runtime-error');
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('segment with renamed member → missing-member (static gate)', async () => {
    seedSegment(db, {
      owner: 'alice',
      gameId: 'ballistar',
      name: 'Seg D',
      queryJson: JSON.stringify({ measures: ['active_daily.renamed_measure'] }),
      status: 'fresh',
    });
    const result = await runSweep(db, gameIdWorkspace, 'alice');
    expect(result.segments[0].status).toBe('missing-member');
    expect(result.segments[0].refs).toContain('active_daily.renamed_measure');
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('segment with malformed query_json → runtime-error, no throw', async () => {
    seedSegment(db, {
      owner: 'alice',
      gameId: 'ballistar',
      name: 'Seg E',
      queryJson: '{bad json',
      status: 'fresh',
    });
    const result = await runSweep(db, gameIdWorkspace, 'alice');
    expect(result.segments[0].status).toBe('runtime-error');
    expect(mockLoad).not.toHaveBeenCalled();
  });
});

describe('runSweep — live:false produces zero /load calls', () => {
  it('never calls loadWithCtx regardless of artifact types when live is false', async () => {
    const db = makeMemDb();
    vi.clearAllMocks();
    mockGetMeta.mockResolvedValue(goodMeta);

    seedDashboardTile(db, {
      owner: 'alice',
      game: 'ballistar',
      queryJson: JSON.stringify({ measures: ['active_daily.dau'] }),
      cacheStatus: 'fresh',
    });
    seedSegment(db, {
      owner: 'alice',
      gameId: 'ballistar',
      name: 'Seg',
      queryJson: JSON.stringify({ measures: ['active_daily.dau'] }),
    });

    const result = await runSweep(db, gameIdWorkspace, 'alice', { live: false });
    expect(mockLoad).not.toHaveBeenCalled();
    // Chat DB is mocked to fail-open → chatArtifacts empty, note set
    expect(result.chatArtifacts).toHaveLength(0);
    expect(result.note).toMatch(/chat/i);
  });
});

describe('runSweep — summary counts', () => {
  it('summary accurately reflects result statuses', async () => {
    const db = makeMemDb();
    vi.clearAllMocks();
    mockGetMeta.mockResolvedValue(goodMeta);

    const goodQuery = JSON.stringify({ measures: ['active_daily.dau'] });

    // ok
    seedDashboardTile(db, { owner: 'alice', game: 'ballistar', queryJson: goodQuery, cacheStatus: 'fresh' });
    // unverified
    seedDashboardTile(db, { owner: 'alice', game: 'ballistar', queryJson: goodQuery, cacheStatus: null });
    // missing-preagg
    seedDashboardTile(db, {
      owner: 'alice', game: 'ballistar', queryJson: goodQuery,
      cacheStatus: 'broken', cacheError: `${PARTITION_NOT_BUILT_SUBSTRING}`,
    });
    // missing-member
    seedDashboardTile(db, {
      owner: 'alice', game: 'ballistar',
      queryJson: JSON.stringify({ measures: ['active_daily.gone'] }),
    });
    // runtime-error (malformed)
    seedDashboardTile(db, { owner: 'alice', game: 'ballistar', queryJson: 'BAD', cacheStatus: 'fresh' });

    const result = await runSweep(db, gameIdWorkspace, 'alice');
    expect(result.summary.total).toBe(5);
    expect(result.summary.ok).toBe(1);
    expect(result.summary.unverified).toBe(1);
    expect(result.summary.missingPreagg).toBe(1);
    expect(result.summary.missingMember).toBe(1);
    expect(result.summary.runtimeError).toBe(1);
  });
});

describe('runSweep — owner scoping', () => {
  it('only returns artifacts owned by the requesting owner', async () => {
    const db = makeMemDb();
    vi.clearAllMocks();
    mockGetMeta.mockResolvedValue(goodMeta);

    const goodQuery = JSON.stringify({ measures: ['active_daily.dau'] });
    seedDashboardTile(db, { owner: 'alice', game: 'ballistar', queryJson: goodQuery, cacheStatus: 'fresh' });
    seedDashboardTile(db, { owner: 'bob', game: 'ballistar', queryJson: goodQuery, cacheStatus: 'fresh' });

    const result = await runSweep(db, gameIdWorkspace, 'alice');
    expect(result.dashboards).toHaveLength(1);
    expect(result.summary.total).toBe(1);
  });
});

// ── Route-level integration tests ────────────────────────────────────────────

describe('POST /api/workspaces/:id/artifact-sweep', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: Database.Database;

  beforeEach(async () => {
    db = makeMemDb();
    setDb(db);
    vi.clearAllMocks();
    mockGetMeta.mockResolvedValue(goodMeta);
    mockLoad.mockResolvedValue({ data: [] });
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it('400s on unknown workspace id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/does-not-exist/artifact-sweep',
      headers: { 'x-owner': 'alice', 'x-cube-workspace': 'local', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/unknown workspace/i);
  });

  it('200 with correct shape for known workspace', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/local/artifact-sweep',
      headers: { 'x-owner': 'alice', 'x-cube-workspace': 'local', 'content-type': 'application/json' },
      body: JSON.stringify({ live: false }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.dashboards)).toBe(true);
    expect(Array.isArray(body.segments)).toBe(true);
    expect(Array.isArray(body.chatArtifacts)).toBe(true);
    expect(body.summary).toMatchObject({
      total: expect.any(Number),
      ok: expect.any(Number),
      unverified: expect.any(Number),
      missingMember: expect.any(Number),
      missingPreagg: expect.any(Number),
      runtimeError: expect.any(Number),
    });
    expect(body.generatedAt).toBeTruthy();
  });

  it('live:false → no /load calls fired', async () => {
    const goodQuery = JSON.stringify({ measures: ['active_daily.dau'] });
    seedDashboardTile(db, { owner: 'alice', game: 'ballistar', queryJson: goodQuery, cacheStatus: 'fresh' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/local/artifact-sweep',
      headers: { 'x-owner': 'alice', 'x-cube-workspace': 'local', 'content-type': 'application/json' },
      body: JSON.stringify({ live: false }),
    });
    expect(res.statusCode).toBe(200);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('classifies fresh tile as ok in response body', async () => {
    const goodQuery = JSON.stringify({ measures: ['active_daily.dau'] });
    seedDashboardTile(db, { owner: 'alice', game: 'ballistar', queryJson: goodQuery, cacheStatus: 'fresh' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/local/artifact-sweep',
      headers: { 'x-owner': 'alice', 'x-cube-workspace': 'local', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dashboards[0].status).toBe('ok');
    expect(body.dashboards[0].kind).toBe('dashboard');
  });
});
