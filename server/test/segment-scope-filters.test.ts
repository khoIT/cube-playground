/**
 * segment-scope-filters: compiles a segment's stored predicate into Cube filters
 * so the diagnosis engine can scope a segment read. Guards the load-bearing
 * branches: a predicate segment compiles to its leaf filters (so segValue !=
 * popValue and a factor can be marked weak), while manual / unknown / malformed
 * segments fail soft to [] (diagnose game-wide rather than fabricate a cohort).
 *
 * The percentile-resolution branch delegates to segment-cutoff-resolver (which
 * needs a live distribution) and is exercised by the segment-refresh path; here
 * we cover the common threshold/equals case and the fail-soft fallbacks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, setDb, closeDb } from '../src/db/sqlite.js';
import { compileSegmentScopeFilters } from '../src/advisor/segment-scope-filters.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const ASOF = new Date('2026-06-20T00:00:00.000Z');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

function seedSegment(id: string, predicateTreeJson: string | null, type = 'predicate'): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO segments (
         id, name, type, owner, status, cube, predicate_tree_json, cube_query_json,
         uid_count, uid_list_json, refresh_cadence_min, last_refreshed_at, created_at, updated_at, game_id
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, 'scope test', type, 'tester', 'fresh', 'mf_users', predicateTreeJson, '{"filters":[]}', 100, '[]', 60, now, now, now, 'cfm_vn');
}

const DOLPHIN_TREE = JSON.stringify({
  kind: 'group',
  id: 'root',
  op: 'AND',
  children: [
    { kind: 'leaf', id: 'l1', member: 'mf_users.payer_tier', type: 'string', op: 'equals', values: ['dolphin'] },
  ],
});

describe('compileSegmentScopeFilters', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => closeDb());

  it('compiles a threshold predicate to its Cube leaf filter', async () => {
    seedSegment('seg-dolphin', DOLPHIN_TREE);
    const filters = await compileSegmentScopeFilters('seg-dolphin', ASOF);
    expect(filters).toEqual([
      { member: 'mf_users.payer_tier', operator: 'equals', values: ['dolphin'] },
    ]);
  });

  it('returns [] for a manual (predicate-less) segment — diagnoses game-wide', async () => {
    seedSegment('seg-manual', null, 'manual');
    expect(await compileSegmentScopeFilters('seg-manual', ASOF)).toEqual([]);
  });

  it('returns [] for an unknown segment id', async () => {
    expect(await compileSegmentScopeFilters('does-not-exist', ASOF)).toEqual([]);
  });

  it('returns [] for a malformed predicate (never throws)', async () => {
    seedSegment('seg-bad', '{not valid json');
    expect(await compileSegmentScopeFilters('seg-bad', ASOF)).toEqual([]);
  });
});
