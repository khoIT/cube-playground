/**
 * A failed refresh must never wipe a card's last-good rows. These tests pin the
 * preservation invariant: an incoming error over a prior 'ok' keeps the good
 * payload + its fetched_at and stays renderable; a fresh success still replaces
 * everything; an error with no prior good value persists as an error entry.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDb, setDb, closeDb } from '../src/db/sqlite.js';
import { upsertCardCache, getCardCache } from '../src/services/card-cache-store.js';

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

function seedSegment(id: string): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO segments (
      id, name, type, owner, status, cube,
      predicate_tree_json, cube_query_json, uid_count, uid_list_json,
      refresh_cadence_min, last_refreshed_at, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, 'cache test', 'predicate', 'tester', 'fresh', 'mf_users',
    '{}', '{"filters":[]}', 0, '[]', 60, null, now, now);
}

const ok = (cardId: string, rows: unknown[], queryHash = 'h1') => ({
  cardId, queryHash, rows, status: 'ok' as const,
});
const errored = (cardId: string, message: string, queryHash = 'h1') => ({
  cardId, queryHash, rows: [] as unknown[], status: 'error' as const, error: message,
});

describe('upsertCardCache — last-good preservation', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    seedSegment('seg1');
  });
  afterEach(() => closeDb());

  it('keeps prior rows + fetched_at when a later refresh errors', () => {
    upsertCardCache('seg1', [ok('kpi:paying', [{ paying: 42 }])]);
    const firstFetchedAt = getCardCache('seg1')['kpi:paying'].fetched_at;

    upsertCardCache('seg1', [errored('kpi:paying', 'Cube request timed out after 15s')]);

    const after = getCardCache('seg1')['kpi:paying'];
    expect(after.rows).toEqual([{ paying: 42 }]); // good rows survived
    expect(after.status).toBe('ok');              // still renderable
    expect(after.fetched_at).toBe(firstFetchedAt); // data age unchanged
    expect(after.error).toBe('Cube request timed out after 15s'); // failure recorded
  });

  it('lets a fresh success fully replace a preserved-but-stale entry', () => {
    upsertCardCache('seg1', [ok('kpi:paying', [{ paying: 42 }])]);
    upsertCardCache('seg1', [errored('kpi:paying', 'timeout')]);
    upsertCardCache('seg1', [ok('kpi:paying', [{ paying: 99 }], 'h2')]);

    const after = getCardCache('seg1')['kpi:paying'];
    expect(after.rows).toEqual([{ paying: 99 }]);
    expect(after.status).toBe('ok');
    expect(after.error).toBeUndefined(); // cleared on success
  });

  it('persists an error entry when there is no prior good value', () => {
    upsertCardCache('seg1', [errored('card:overview:installs-90d', 'timeout')]);
    const after = getCardCache('seg1')['card:overview:installs-90d'];
    expect(after.status).toBe('error');
    expect(after.rows).toEqual([]);
  });

  it('does not preserve over an error when the prior entry was also an error', () => {
    upsertCardCache('seg1', [errored('kpi:ltv', 'no pre-agg')]);
    upsertCardCache('seg1', [errored('kpi:ltv', 'timeout')]);
    const after = getCardCache('seg1')['kpi:ltv'];
    expect(after.status).toBe('error');
    expect(after.error).toBe('timeout'); // latest failure lands
  });
});
