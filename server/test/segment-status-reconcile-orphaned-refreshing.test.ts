/**
 * A segment left 'refreshing' by a gateway that died mid-refresh is an orphan:
 * the refresh queue is in-memory, so nothing is actually in-flight at boot, yet
 * listDueSegments() skips 'refreshing' rows and would never re-enqueue it. These
 * tests pin the boot-time recovery: reconcileOrphanedRefreshing() flips every
 * 'refreshing' row to 'stale' (re-evaluable next tick) and leaves other statuses
 * untouched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDb, setDb, closeDb } from '../src/db/sqlite.js';
import { reconcileOrphanedRefreshing } from '../src/services/segment-status.js';
import type { SegmentStatus } from '../src/types/segment.js';

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

function seedSegment(id: string, status: SegmentStatus): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO segments (
      id, name, type, owner, status, cube,
      predicate_tree_json, cube_query_json, uid_count, uid_list_json,
      refresh_cadence_min, last_refreshed_at, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, `seg ${id}`, 'predicate', 'tester', status, 'mf_users',
    '{}', '{"filters":[]}', 0, '[]', 60, null, now, now);
}

function statusOf(id: string): string {
  return (getDb().prepare('SELECT status FROM segments WHERE id = ?').get(id) as { status: string }).status;
}

describe('reconcileOrphanedRefreshing', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => closeDb());

  it("flips 'refreshing' orphans to 'stale' and returns the count", () => {
    seedSegment('orphan1', 'refreshing');
    seedSegment('orphan2', 'refreshing');

    const reset = reconcileOrphanedRefreshing();

    expect(reset).toBe(2);
    expect(statusOf('orphan1')).toBe('stale');
    expect(statusOf('orphan2')).toBe('stale');
  });

  it('leaves fresh / stale / broken segments untouched', () => {
    seedSegment('keep-fresh', 'fresh');
    seedSegment('keep-stale', 'stale');
    seedSegment('keep-broken', 'broken');
    seedSegment('orphan', 'refreshing');

    const reset = reconcileOrphanedRefreshing();

    expect(reset).toBe(1);
    expect(statusOf('keep-fresh')).toBe('fresh');
    expect(statusOf('keep-stale')).toBe('stale');
    expect(statusOf('keep-broken')).toBe('broken');
    expect(statusOf('orphan')).toBe('stale');
  });

  it('is a no-op on a clean boot (no refreshing rows)', () => {
    seedSegment('a', 'fresh');
    seedSegment('b', 'broken');

    expect(reconcileOrphanedRefreshing()).toBe(0);
    expect(statusOf('a')).toBe('fresh');
    expect(statusOf('b')).toBe('broken');
  });
});
