import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDb, setDb, closeDb } from '../src/db/sqlite.js';
import { refreshSegment } from '../src/jobs/refresh-segment.js';
import * as cubeClient from '../src/services/cube-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

// Per-test in-memory DB so this suite never touches data/segments.db. Without
// this guard, seedSegment() runs against the live dev DB and clobbers rows the
// running server depends on (notably resets seg_test_refresh.game_id default).
function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

function seedSegment(): string {
  const db = getDb();
  const id = 'seg_test_refresh';
  const now = new Date().toISOString();
  db.prepare('DELETE FROM segments WHERE id = ?').run(id);
  db.prepare('DELETE FROM cube_identity_map WHERE cube = ?').run('mf_users');
  db.prepare(`
    INSERT INTO segments (
      id, name, type, owner, status, cube,
      predicate_tree_json, cube_query_json,
      uid_count, uid_list_json,
      refresh_cadence_min, last_refreshed_at,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id,
    'test live',
    'predicate',
    'tester',
    'fresh',
    'mf_users',
    JSON.stringify({ kind: 'group', id: 'g', op: 'AND', children: [] }),
    JSON.stringify({ measures: ['mf_users.count'], filters: [] }),
    0,
    '[]',
    60,
    null,
    now,
    now,
  );
  db.prepare(`
    INSERT INTO cube_identity_map (cube, identity_field, source, confidence, updated_at)
    VALUES ('mf_users', 'mf_users.user_id', 'manual', 1, ?)
  `).run(now);
  return id;
}

function getSegment(id: string) {
  const db = getDb();
  return db.prepare('SELECT status, broken_reason, uid_count, uid_list_json FROM segments WHERE id = ?').get(id) as {
    status: string;
    broken_reason: string | null;
    uid_count: number;
    uid_list_json: string;
  };
}

describe('refreshSegment', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    vi.restoreAllMocks();
  });

  afterEach(() => {
    closeDb();
  });

  it('writes uids and marks status=fresh on happy path', async () => {
    const id = seedSegment();
    // refresh-segment runs two loads: (1) size with total:true, (2) paginated
    // uid fetch. Cube returns total + data in a single payload when total:true
    // is set, so the same mock satisfies both phases.
    vi.spyOn(cubeClient, 'load').mockResolvedValue({
      results: [{
        total: 2,
        data: [
          { 'mf_users.user_id': 'u1' },
          { 'mf_users.user_id': 'u2' },
          { 'mf_users.user_id': 'u1' },
        ],
      }],
    } as never);

    await refreshSegment(id);
    const row = getSegment(id);
    expect(row.status).toBe('fresh');
    expect(row.uid_count).toBe(2);
    expect(JSON.parse(row.uid_list_json)).toEqual(['u1', 'u2']);
  });

  it('marks status=broken on cube error', async () => {
    const id = seedSegment();
    vi.spyOn(cubeClient, 'load').mockRejectedValue(new Error('cube down'));
    await refreshSegment(id);
    const row = getSegment(id);
    expect(row.status).toBe('broken');
    expect(row.broken_reason).toContain('cube down');
  });

  it('preserves prior status + broken_reason on transient network errors', async () => {
    const id = seedSegment();
    // Pre-seed with a prior "broken" reason from a real schema error so we can
    // verify a transient outage doesn't clobber it with a fresh ECONNREFUSED.
    getDb().prepare(
      "UPDATE segments SET status='broken', broken_reason='Schema drift — missing members: foo' WHERE id = ?",
    ).run(id);

    vi.spyOn(cubeClient, 'load').mockRejectedValue(
      new Error('connect ECONNREFUSED 10.164.54.88:8080'),
    );
    await refreshSegment(id);

    const row = getSegment(id);
    expect(row.status).toBe('broken');
    expect(row.broken_reason).toBe('Schema drift — missing members: foo');
  });

  it('falls back to auto-suggester when manual identity-field mapping is missing', async () => {
    const id = seedSegment();
    const db = getDb();
    db.prepare('DELETE FROM cube_identity_map WHERE cube = ?').run('mf_users');
    // Auto-suggester picks `mf_users.user_id` (confidence 0.95) → refresh proceeds.
    vi.spyOn(cubeClient, 'getMeta').mockResolvedValue({
      cubes: [{ name: 'mf_users', dimensions: [{ name: 'mf_users.user_id' }] }],
    } as never);
    vi.spyOn(cubeClient, 'load').mockResolvedValue({
      total: 1,
      data: [{ 'mf_users.user_id': 'u1' }],
    } as never);
    await refreshSegment(id);
    const row = getSegment(id);
    expect(row.status).toBe('fresh');
    expect(row.uid_count).toBe(1);
  });

  it('records the true total count from total:true even when cohort exceeds Cube page cap', async () => {
    const id = seedSegment();
    // Simulate a cohort of 12,345 — bigger than Cube's default 10k rowLimit.
    // Phase 1 (size): returns total=12345 with limit:1.
    // Phase 2 (page 1): 10000 rows.
    // Phase 3 (page 2): remaining 2345 rows.
    const make = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ 'mf_users.user_id': `u${start + i}` }));
    const loadMock = vi.spyOn(cubeClient, 'load');
    loadMock.mockImplementation(async (query: unknown) => {
      const q = query as { limit?: number; offset?: number; total?: boolean };
      if (q.total) return { total: 12345, data: [] } as never;
      const offset = q.offset ?? 0;
      const remaining = Math.max(0, 12345 - offset);
      const take = Math.min(q.limit ?? 0, remaining);
      return { data: make(offset, take) } as never;
    });

    await refreshSegment(id);
    const row = getSegment(id);
    expect(row.status).toBe('fresh');
    // True count from total:true, NOT capped at 10k.
    expect(row.uid_count).toBe(12345);
    // uid_list materialized in full because 12345 < MAX_UID_LIST (100k).
    expect(JSON.parse(row.uid_list_json)).toHaveLength(12345);
  });

  it('transparently retries when Cube responds with "Continue wait" (async precompute warming)', async () => {
    const id = seedSegment();
    // Simulate the warm-up handshake: Cube returns "Continue wait" twice,
    // then succeeds. refresh-segment should poll through the retries instead
    // of marking the segment broken on the first attempt.
    let calls = 0;
    vi.spyOn(cubeClient, 'load').mockImplementation(async (query: unknown) => {
      calls += 1;
      if (calls <= 2) throw new Error('Cube /load: Continue wait');
      const q = query as { total?: boolean };
      if (q.total) return { total: 3, data: [] } as never;
      return {
        data: [
          { 'mf_users.user_id': 'a' },
          { 'mf_users.user_id': 'b' },
          { 'mf_users.user_id': 'c' },
        ],
      } as never;
    });
    await refreshSegment(id);
    const row = getSegment(id);
    expect(row.status).toBe('fresh');
    expect(row.uid_count).toBe(3);
    expect(calls).toBeGreaterThanOrEqual(3);
  });


  it('marks status=broken when no identity-field mapping exists and auto-suggest has no hit', async () => {
    const id = seedSegment();
    const db = getDb();
    db.prepare('DELETE FROM cube_identity_map WHERE cube = ?').run('mf_users');
    // Mock /meta to return a cube with no identifiable user dim, so the
    // auto-suggest fallback in getIdentityField returns null.
    vi.spyOn(cubeClient, 'getMeta').mockResolvedValue({
      cubes: [{ name: 'mf_users', dimensions: [{ name: 'mf_users.unrelated_dim' }] }],
    } as never);
    await refreshSegment(id);
    const row = getSegment(id);
    expect(row.status).toBe('broken');
    expect(row.broken_reason).toContain('no identity-field mapping');
  });
});
