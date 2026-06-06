import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDb, setDb, closeDb } from '../src/db/sqlite.js';
import {
  upsertMember360Cache,
  getMember360Cache,
  listOkMember360CacheKeys,
  pruneMember360CacheToUids,
  type Member360CacheEntry,
} from '../src/services/member360-cache-store.js';

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
  `).run(id, 'm360 cache test', 'predicate', 'tester', 'fresh', 'mf_users',
    '{}', '{"filters":[]}', 0, '[]', 60, null, now, now);
}

const entry = (
  uid: string,
  panelId: string,
  over: Partial<Member360CacheEntry> = {},
): Member360CacheEntry => ({
  uid,
  panelId,
  queryHash: 'h1',
  rows: [{ v: 1 }],
  status: 'ok',
  ...over,
});

function fetchedAt(segmentId: string, uid: string, panelId: string): string | undefined {
  const row = getDb()
    .prepare('SELECT fetched_at FROM segment_member360_cache WHERE segment_id=? AND uid=? AND panel_id=?')
    .get(segmentId, uid, panelId) as { fetched_at: string } | undefined;
  return row?.fetched_at;
}

describe('member360-cache-store', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    seedSegment('seg1');
  });
  afterEach(() => closeDb());

  it('upserts and reads back per-member panel views', () => {
    upsertMember360Cache('seg1', [
      entry('u1', 'profile'),
      entry('u1', 'transactions', { rows: [{ v: 2 }] }),
      entry('u2', 'profile', { status: 'error', error: 'boom', rows: [] }),
    ]);
    const u1 = getMember360Cache('seg1', 'u1');
    expect(Object.keys(u1).sort()).toEqual(['profile', 'transactions']);
    expect(u1.profile.rows).toEqual([{ v: 1 }]);
    expect(u1.profile.status).toBe('ok');
    const u2 = getMember360Cache('seg1', 'u2');
    expect(u2.profile.status).toBe('error');
    expect(u2.profile.error).toBe('boom');
  });

  it('skips the write when hash + rows + status + error are unchanged', async () => {
    upsertMember360Cache('seg1', [entry('u1', 'profile')]);
    const first = fetchedAt('seg1', 'u1', 'profile');
    await new Promise((r) => setTimeout(r, 5));
    upsertMember360Cache('seg1', [entry('u1', 'profile')]);
    expect(fetchedAt('seg1', 'u1', 'profile')).toBe(first); // no-op write
  });

  it('writes when status flips even if rows are identical', async () => {
    upsertMember360Cache('seg1', [entry('u1', 'profile', { status: 'error', error: 'x', rows: [] })]);
    const first = fetchedAt('seg1', 'u1', 'profile');
    await new Promise((r) => setTimeout(r, 5));
    upsertMember360Cache('seg1', [entry('u1', 'profile', { rows: [] })]);
    expect(fetchedAt('seg1', 'u1', 'profile')).not.toBe(first);
    expect(getMember360Cache('seg1', 'u1').profile.status).toBe('ok');
  });

  it('lists ok cache keys only', () => {
    upsertMember360Cache('seg1', [
      entry('u1', 'profile'),
      entry('u1', 'roles', { status: 'error', error: 'x', rows: [] }),
    ]);
    expect(listOkMember360CacheKeys('seg1')).toEqual(new Set(['u1|profile']));
  });

  it('prunes rows for uids that left the tier set, keeps survivors', () => {
    upsertMember360Cache('seg1', [entry('u1', 'profile'), entry('u2', 'profile'), entry('u3', 'profile')]);
    const removed = pruneMember360CacheToUids('seg1', ['u1', 'u3']);
    expect(removed).toBe(1);
    expect(Object.keys(getMember360Cache('seg1', 'u1'))).toEqual(['profile']);
    expect(Object.keys(getMember360Cache('seg1', 'u2'))).toEqual([]);
    expect(Object.keys(getMember360Cache('seg1', 'u3'))).toEqual(['profile']);
  });

  it('empty keep set wipes the segment cache (ineligibility)', () => {
    upsertMember360Cache('seg1', [entry('u1', 'profile'), entry('u2', 'profile')]);
    expect(pruneMember360CacheToUids('seg1', [])).toBe(2);
    expect(Object.keys(getMember360Cache('seg1', 'u1'))).toEqual([]);
  });
});
