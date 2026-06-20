/**
 * Segment-compare routes — same-game guard, unknown-segment 404, staleness flag
 * at the 24h boundary, and save-region landing a manual segment with the right
 * uid_count. Overlap set-math + connector mocked; auth + segment store real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const computeSegmentOverlapMock = vi.fn();
const fetchRegionUidsMock = vi.fn();
vi.mock('../src/lakehouse/segment-overlap-counts.js', () => ({
  computeSegmentOverlap: (...a: unknown[]) => computeSegmentOverlapMock(...a),
  fetchRegionUids: (...a: unknown[]) => fetchRegionUidsMock(...a),
}));

vi.mock('../src/lakehouse/lakehouse-trino-connector.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lakehouse/lakehouse-trino-connector.js')>();
  return {
    ...actual,
    lakehouseConnectorFromEnv: () => ({
      id: 'test', label: 'test', workspaceId: 'local', sourceType: 'trino',
      host: 'unused', port: 8080, user: 'u', password: '', catalog: 'game_integration', ssl: false,
    }),
  };
});

const computeRegionMetricsMock = vi.fn();
vi.mock('../src/services/segment-overlap-region-metrics.js', () => ({
  REGION_METRIC_UID_CAP: 1000,
  computeRegionMetrics: (...a: unknown[]) => computeRegionMetricsMock(...a),
}));

import { buildApp } from '../src/index.js';
import { setDb, closeDb, getDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';

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

const HOUR = 60 * 60 * 1000;

describe('segment-compare routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let auth: { authorization: string };
  let aId: string;
  let bId: string;
  let otherGameId: string;

  async function makeSeg(name: string, game: string): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/api/segments', headers: auth,
      payload: { name, type: 'manual', uid_list: ['u1'], cube: 'mf_users', game_id: game },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    computeSegmentOverlapMock.mockReset();
    fetchRegionUidsMock.mockReset();
    computeRegionMetricsMock.mockReset();
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    app = await buildApp();
    auth = { authorization: `Bearer ${await signAppJwt({ sub: 'alice-sub', username: 'alice', email: 'alice@corp.com', role: 'editor' })}` };
    aId = await makeSeg('Segment A', 'cfm_vn');
    bId = await makeSeg('Segment B', 'cfm_vn');
    otherGameId = await makeSeg('Other game seg', 'jus_vn');
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  function nowIso(offsetMs: number): string {
    return new Date(Date.now() + offsetMs).toISOString().replace('T', ' ').replace('Z', '');
  }

  it('returns overlap counts; fresh snapshot is not stale', async () => {
    computeSegmentOverlapMock.mockResolvedValue({
      aSize: 100, bSize: 60, both: 20, aOnly: 80, bOnly: 40, jaccard: 20 / 140,
      aSnapshotDate: '2026-06-21', bSnapshotDate: '2026-06-21',
      aSnapshotTs: nowIso(-1 * HOUR), bSnapshotTs: nowIso(-2 * HOUR),
    });
    const res = await app.inject({ method: 'GET', url: `/api/segments/compare?a=${aId}&b=${bId}`, headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.a_only).toBe(80);
    expect(body.both).toBe(20);
    expect(body.b_only).toBe(40);
    expect(body.a.stale).toBe(false);
    expect(body.a.has_snapshot).toBe(true);
  });

  it('flags stale when a snapshot is older than 24h', async () => {
    computeSegmentOverlapMock.mockResolvedValue({
      aSize: 1, bSize: 1, both: 0, aOnly: 1, bOnly: 1, jaccard: 0,
      aSnapshotDate: null, bSnapshotDate: null,
      aSnapshotTs: nowIso(-30 * HOUR), bSnapshotTs: nowIso(-1 * HOUR),
    });
    const res = await app.inject({ method: 'GET', url: `/api/segments/compare?a=${aId}&b=${bId}`, headers: auth });
    expect(res.json().a.stale).toBe(true);
    expect(res.json().b.stale).toBe(false);
  });

  it('rejects a cross-game pair', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/segments/compare?a=${aId}&b=${otherGameId}`, headers: auth });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CROSS_GAME');
    expect(computeSegmentOverlapMock).not.toHaveBeenCalled();
  });

  it('404s an unknown segment', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/segments/compare?a=${aId}&b=nope`, headers: auth });
    expect(res.statusCode).toBe(404);
  });

  it('treats a segment in another workspace as not-found (invisibility, not 403)', async () => {
    // Move segment B to a different workspace directly in the store, then a
    // same-workspace caller must see 404 — never a 403 that would confirm it exists.
    getDb().prepare('UPDATE segments SET workspace = ? WHERE id = ?').run('other-ws', bId);
    const res = await app.inject({ method: 'GET', url: `/api/segments/compare?a=${aId}&b=${bId}`, headers: auth });
    expect(res.statusCode).toBe(404);
    expect(computeSegmentOverlapMock).not.toHaveBeenCalled();
  });

  it('saves a region as a manual segment with the region uid_count', async () => {
    fetchRegionUidsMock.mockResolvedValue(['u1', 'u2', 'u3']);
    const res = await app.inject({
      method: 'POST', url: '/api/segments/compare/save-region', headers: auth,
      payload: { a: aId, b: bId, region: 'both', name: 'A ∩ B' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().uid_count).toBe(3);
    // It is now a readable manual segment in the library.
    const detail = await app.inject({ method: 'GET', url: `/api/segments/${res.json().id}`, headers: auth });
    expect(detail.json().type).toBe('manual');
    expect(detail.json().uid_count).toBe(3);
  });

  it('rejects saving an empty region', async () => {
    fetchRegionUidsMock.mockResolvedValue([]);
    const res = await app.inject({
      method: 'POST', url: '/api/segments/compare/save-region', headers: auth,
      payload: { a: aId, b: bId, region: 'aOnly', name: 'empty' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('EMPTY_REGION');
  });
});
