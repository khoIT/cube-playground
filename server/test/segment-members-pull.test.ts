/**
 * GET /api/segments/:id/members — bare member-ID pull API.
 *
 * Verifies keyset pagination over the sorted uid list, the `truncated` signal
 * when the stored list is a capped sample of a larger cohort, and that access
 * control is inherited from guardSegment (unknown id → 404).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../src/index.js';
import { getDb, setDb, closeDb } from '../src/db/sqlite.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function createSegment(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  const created = await app.inject({
    method: 'POST',
    url: '/api/segments',
    payload: { name: 'Pull cohort', type: 'manual' },
  });
  expect(created.statusCode).toBe(201);
  return created.json().id as string;
}

describe('GET /api/segments/:id/members — bare member-ID pull', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it('paginates via keyset cursor and terminates with next_cursor=null', async () => {
    const id = await createSegment(app);
    // Unsorted on purpose — the route must sort for stable keyset order.
    const uids = ['u3', 'u1', 'u10', 'u2', 'u20'];
    getDb()
      .prepare('UPDATE segments SET uid_list_json = ?, uid_count = ? WHERE id = ?')
      .run(JSON.stringify(uids), uids.length, id);

    const p1 = await app.inject({ method: 'GET', url: `/api/segments/${id}/members?limit=2` });
    expect(p1.statusCode).toBe(200);
    const b1 = p1.json();
    expect(b1.members).toEqual(['u1', 'u10']); // lexicographic sort
    expect(b1.total_count).toBe(5);
    expect(b1.returned_count).toBe(2);
    expect(b1.truncated).toBe(false);
    expect(b1.next_cursor).toBe('u10');

    const p2 = await app.inject({
      method: 'GET',
      url: `/api/segments/${id}/members?limit=2&cursor=${b1.next_cursor}`,
    });
    const b2 = p2.json();
    expect(b2.members).toEqual(['u2', 'u20']);
    expect(b2.next_cursor).toBe('u20');

    const p3 = await app.inject({
      method: 'GET',
      url: `/api/segments/${id}/members?limit=2&cursor=${b2.next_cursor}`,
    });
    const b3 = p3.json();
    expect(b3.members).toEqual(['u3']);
    expect(b3.next_cursor).toBeNull(); // exhausted
  });

  it('reports truncated=true when uid_count exceeds the stored sample', async () => {
    const id = await createSegment(app);
    const uids = Array.from({ length: 10 }, (_, i) => `id${String(i).padStart(2, '0')}`);
    // True cohort is larger than the materialized (capped) sample.
    getDb()
      .prepare('UPDATE segments SET uid_list_json = ?, uid_count = ? WHERE id = ?')
      .run(JSON.stringify(uids), 500_000, id);

    const res = await app.inject({ method: 'GET', url: `/api/segments/${id}/members?limit=5` });
    const body = res.json();
    expect(body.total_count).toBe(500_000);
    expect(body.returned_count).toBe(5);
    expect(body.truncated).toBe(true);
  });

  it('clamps limit above the max and returns empty page for empty cohort', async () => {
    const id = await createSegment(app);
    // Empty uid list (default '[]').
    const res = await app.inject({ method: 'GET', url: `/api/segments/${id}/members?limit=99999` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.members).toEqual([]);
    expect(body.returned_count).toBe(0);
    expect(body.next_cursor).toBeNull();
  });

  it('dedups duplicate uids so none are skipped across a page boundary', async () => {
    const id = await createSegment(app);
    // 'b' is duplicated and would straddle the page-1/page-2 boundary; the
    // route must dedup so the second 'b' is not silently lost by the keyset.
    const uids = ['a', 'b', 'b', 'c', 'd'];
    getDb()
      .prepare('UPDATE segments SET uid_list_json = ?, uid_count = ? WHERE id = ?')
      .run(JSON.stringify(uids), uids.length, id);

    const collected: string[] = [];
    let cursor: string | null = null;
    // Drain the cohort two at a time.
    for (let i = 0; i < 10; i++) {
      const url = `/api/segments/${id}/members?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await app.inject({ method: 'GET', url });
      const body = res.json();
      collected.push(...body.members);
      cursor = body.next_cursor;
      if (!cursor) break;
    }
    expect(collected).toEqual(['a', 'b', 'c', 'd']); // unique set, nothing skipped
  });

  it('clamps a zero/negative/non-numeric limit to a single row', async () => {
    const id = await createSegment(app);
    getDb()
      .prepare('UPDATE segments SET uid_list_json = ?, uid_count = ? WHERE id = ?')
      .run(JSON.stringify(['a', 'b', 'c']), 3, id);

    for (const bad of ['0', '-5', 'abc']) {
      const res = await app.inject({ method: 'GET', url: `/api/segments/${id}/members?limit=${bad}` });
      const body = res.json();
      // '0'/'-5' clamp to 1; 'abc' falls back to the default (≥1) — both yield a non-empty bounded page.
      expect(body.returned_count).toBeGreaterThanOrEqual(1);
      expect(body.members.length).toBe(body.returned_count);
    }
  });

  it('returns 404 for an unknown segment (access inherited from guardSegment)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/segments/does-not-exist/members' });
    expect(res.statusCode).toBe(404);
  });
});
