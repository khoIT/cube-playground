/**
 * cohort-resolver: grounds an experiment Target in real platform facts —
 * addressableN from the segment's uid_count, reachablePct from its CS Care
 * coverage. Both return null when the fact isn't known so callers can default.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, setDb, closeDb } from '../src/db/sqlite.js';
import { resolveAddressableN, resolveReachablePct } from '../src/advisor/cohort-resolver.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

function seedSegment(id: string, uidCount: number): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO segments (
         id, name, type, owner, status, cube, predicate_tree_json, cube_query_json,
         uid_count, uid_list_json, refresh_cadence_min, last_refreshed_at, created_at, updated_at, game_id
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, 'resolver test', 'predicate', 'tester', 'fresh', 'mf_users', '{}', '{"filters":[]}', uidCount, '[]', 60, now, now, now, 'cfm_vn');
}

function seedCareCoverage(segmentId: string, pct: number): void {
  const payload = JSON.stringify({
    coverage: { totalMembers: 1000, contactedMembers: Math.round((pct / 100) * 1000), pct, truncated: false },
  });
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO segment_care_cache (segment_id, game_id, payload_json, computed_at, last_attempt_at, status)
       VALUES (?,?,?,?,?, 'ok')`,
    )
    .run(segmentId, 'cfm_vn', payload, now, now);
}

describe('cohort-resolver', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => closeDb());

  it('resolves addressableN from the segment uid_count', () => {
    seedSegment('seg-a', 7_180_000);
    expect(resolveAddressableN('seg-a')).toBe(7_180_000);
  });

  it('returns null addressableN for an unknown or empty segment', () => {
    expect(resolveAddressableN('missing')).toBeNull();
    seedSegment('seg-empty', 0);
    expect(resolveAddressableN('seg-empty')).toBeNull();
  });

  it('resolves reachablePct (0–1) from CS Care coverage when present', () => {
    seedSegment('seg-cov', 1000);
    seedCareCoverage('seg-cov', 62);
    expect(resolveReachablePct('seg-cov')).toBeCloseTo(0.62, 5);
  });

  it('returns null reachablePct when no Care snapshot exists', () => {
    seedSegment('seg-nocov', 1000);
    expect(resolveReachablePct('seg-nocov')).toBeNull();
  });
});
