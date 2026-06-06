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

const entry = (cardId: string) => ({
  cardId,
  queryHash: 'h1',
  rows: [{ v: 1 }],
  status: 'ok' as const,
});

describe('upsertCardCache — ghost-row pruning', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    seedSegment('seg1');
  });
  afterEach(() => closeDb());

  it('prunes rows for card ids the current preset no longer declares', () => {
    // First pass writes a card that is later renamed in the preset spec.
    upsertCardCache('seg1', [entry('card:overview:matches-90d'), entry('kpi:players')]);
    upsertCardCache('seg1', [entry('card:overview:matches-30d'), entry('kpi:players')]);

    const cache = getCardCache('seg1');
    expect(Object.keys(cache).sort()).toEqual(['card:overview:matches-30d', 'kpi:players']);
  });

  it('does not prune anything when the entry set is empty (failed pass)', () => {
    upsertCardCache('seg1', [entry('kpi:players')]);
    upsertCardCache('seg1', []);
    expect(Object.keys(getCardCache('seg1'))).toEqual(['kpi:players']);
  });

  it('only prunes the target segment', () => {
    seedSegment('seg2');
    upsertCardCache('seg1', [entry('kpi:old')]);
    upsertCardCache('seg2', [entry('kpi:other')]);
    upsertCardCache('seg1', [entry('kpi:new')]);
    expect(Object.keys(getCardCache('seg1'))).toEqual(['kpi:new']);
    expect(Object.keys(getCardCache('seg2'))).toEqual(['kpi:other']);
  });
});
