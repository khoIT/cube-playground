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
    vi.spyOn(cubeClient, 'load').mockResolvedValue({
      results: [{
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

  it('falls back to auto-suggester when manual identity-field mapping is missing', async () => {
    const id = seedSegment();
    const db = getDb();
    db.prepare('DELETE FROM cube_identity_map WHERE cube = ?').run('mf_users');
    // Auto-suggester picks `mf_users.user_id` (confidence 0.95) → refresh proceeds.
    vi.spyOn(cubeClient, 'getMeta').mockResolvedValue({
      cubes: [{ name: 'mf_users', dimensions: [{ name: 'mf_users.user_id' }] }],
    } as never);
    vi.spyOn(cubeClient, 'load').mockResolvedValue({
      data: [{ 'mf_users.user_id': 'u1' }],
    } as never);
    await refreshSegment(id);
    const row = getSegment(id);
    expect(row.status).toBe('fresh');
    expect(row.uid_count).toBe(1);
  });

  it('marks status=broken when Cube responds with "Continue wait" (async precompute)', async () => {
    // Cold pre-aggregate: Cube returns HTTP 200 with `{error: "Continue wait"}`.
    // Without explicit handling, the refresh would read `data ?? []` → store
    // uid_count=0 + status=fresh — a silent false positive that masks cold
    // caches as "0 matches". The cube-client throws on the error field; the
    // refresh job propagates the error into broken_reason.
    const id = seedSegment();
    vi.spyOn(cubeClient, 'load').mockRejectedValue(new Error('Cube /load: Continue wait'));
    await refreshSegment(id);
    const row = getSegment(id);
    expect(row.status).toBe('broken');
    expect(row.broken_reason).toContain('Continue wait');
    expect(row.uid_count).toBe(0);
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
