import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDb, setDb, closeDb } from '../src/db/sqlite.js';
import { hydrateFromSnapshot } from '../src/db/snapshot-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const SNAPSHOT_PATH = join(__dirname, '..', 'data', 'seed', 'segments-snapshot.json');
const SNAPSHOT_BAK = `${SNAPSHOT_PATH}.test-backup`;

// hydrateFromSnapshot reads SNAPSHOT_PATH directly (not parameterised), so the
// test owns the file: stash the real seed before each case, write a tiny
// fixture, and restore on cleanup.
function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

function seedRow(overrides: Partial<{ id: string; name: string; game_id: string }> = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'seg-a',
    name: overrides.name ?? 'Segment A',
    type: 'predicate',
    owner: 'tester',
    status: 'fresh',
    cube: 'mf_users',
    predicate_tree_json: '{}',
    cube_query_json: '{"measures":["mf_users.count"]}',
    sql_preview: null,
    uid_count: 0,
    uid_list_json: '[]',
    refresh_cadence_min: 60,
    last_refreshed_at: null,
    broken_reason: null,
    created_at: now,
    updated_at: now,
    predicate_meta_version: null,
    game_id: overrides.game_id ?? 'ballistar',
    activations_json: '[]',
  };
}

function writeFixture(rows: ReturnType<typeof seedRow>[]) {
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(
    SNAPSHOT_PATH,
    JSON.stringify(
      { version: 1, segments: rows, segment_tags: [], segment_card_cache: [], cube_identity_map: [] },
      null,
      2,
    ),
  );
}

describe('hydrateFromSnapshot', () => {
  beforeEach(() => {
    if (existsSync(SNAPSHOT_PATH)) {
      writeFileSync(SNAPSHOT_BAK, readFileSync(SNAPSHOT_PATH));
    }
    setDb(makeMemDb());
  });

  afterEach(() => {
    closeDb();
    if (existsSync(SNAPSHOT_BAK)) {
      writeFileSync(SNAPSHOT_PATH, readFileSync(SNAPSHOT_BAK));
      rmSync(SNAPSHOT_BAK);
    }
  });

  it('inserts every snapshot row into an empty DB', () => {
    writeFixture([seedRow({ id: 'a' }), seedRow({ id: 'b' }), seedRow({ id: 'c' })]);
    const result = hydrateFromSnapshot();
    expect(result.hydrated).toBe(true);
    expect(result.counts.segments).toBe(3);
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM segments').get()).toEqual({ c: 3 });
  });

  it('backfills missing rows without clobbering existing ones (idempotent)', () => {
    // DB starts with ONE segment that also exists in the snapshot — but with a
    // locally edited name. We expect: missing rows added, local edit preserved.
    const db = getDb();
    db.prepare(`
      INSERT INTO segments (id, name, type, owner, status, cube, uid_list_json, game_id)
      VALUES ('a', 'LOCAL EDIT', 'predicate', 'tester', 'fresh', 'mf_users', '[]', 'ballistar')
    `).run();

    writeFixture([
      seedRow({ id: 'a', name: 'snapshot version of a' }),
      seedRow({ id: 'b' }),
      seedRow({ id: 'c' }),
    ]);

    const result = hydrateFromSnapshot();
    expect(result.hydrated).toBe(true);
    // 2 of 3 inserted; the pre-existing 'a' was IGNORE'd.
    expect(result.counts.segments).toBe(2);

    const rows = db.prepare('SELECT id, name FROM segments ORDER BY id').all() as Array<{ id: string; name: string }>;
    expect(rows).toEqual([
      { id: 'a', name: 'LOCAL EDIT' }, // local row preserved
      { id: 'b', name: 'Segment A' },
      { id: 'c', name: 'Segment A' },
    ]);
  });

  it('reports hydrated=false when the DB is already in sync', () => {
    writeFixture([seedRow({ id: 'a' })]);
    hydrateFromSnapshot(); // first call inserts
    const second = hydrateFromSnapshot(); // second is a no-op
    expect(second.hydrated).toBe(false);
    expect(second.counts.segments).toBe(0);
  });
});
