/**
 * Regression: the refresh-log routes must emit timestamps as ISO-8601 UTC
 * (trailing `Z`), not SQLite's naive `YYYY-MM-DD HH:MM:SS`.
 *
 * `datetime('now')` stores UTC without a timezone marker. A space-separated
 * naive datetime is parsed by the browser's `new Date()` as LOCAL time, so a
 * row written *now* renders as "<utc-offset> hours ago" (e.g. 7h in GMT+7).
 * Serializing with an explicit `Z` makes the instant unambiguous so every FE
 * consumer (history table, library sparklines) reads the correct time.
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
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

describe('refresh-log routes — ISO-8601 UTC timestamps', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  async function seedSegmentWithLog(): Promise<string> {
    const created = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: { name: 'Logged cohort', type: 'manual' },
    });
    const id = created.json().id as string;
    // A row written "now" — the regression case the user reported.
    getDb()
      .prepare('INSERT INTO segment_refresh_log (segment_id, uid_count, status) VALUES (?, ?, ?)')
      .run(id, 42, 'fresh');
    return id;
  }

  it('GET /:id/refresh-log returns ts with a trailing Z that parses as a fresh instant', async () => {
    const id = await seedSegmentWithLog();
    const res = await app.inject({ method: 'GET', url: `/api/segments/${id}/refresh-log` });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ ts: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].ts).toMatch(ISO_Z);
    // Parsed instant is within a minute of now — i.e. NOT shifted by the UTC offset.
    const ageMin = Math.abs(Date.now() - new Date(rows[0].ts).getTime()) / 60000;
    expect(ageMin).toBeLessThan(1);
  });

  it('POST /refresh-logs (bulk) returns ts with a trailing Z', async () => {
    const id = await seedSegmentWithLog();
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments/refresh-logs',
      payload: { ids: [id], days: 7 },
    });
    expect(res.statusCode).toBe(200);
    const grouped = res.json() as Record<string, Array<{ ts: string }>>;
    expect(grouped[id]).toHaveLength(1);
    expect(grouped[id][0].ts).toMatch(ISO_Z);
  });

  it('hydrateSegment normalizes naive-default created_at/updated_at to ISO-Z', async () => {
    // Mirror a fixture/legacy row: timestamps written via SQLite datetime('now')
    // (naive UTC, space-separated). hydrateSegment must serialize them with a Z.
    getDb()
      .prepare(
        `INSERT INTO segments (id, name, type, owner, status, cube, uid_count, uid_list_json,
            last_refreshed_at, created_at, updated_at)
         VALUES (?, ?, 'manual', 'fixture@local', 'fresh', 'mf_users', 0, '[]',
            datetime('now'), datetime('now'), datetime('now'))`,
      )
      .run('seg_naive', 'Naive cohort');
    const res = await app.inject({ method: 'GET', url: '/api/segments/seg_naive' });
    expect(res.statusCode).toBe(200);
    const seg = res.json() as { created_at: string; updated_at: string; last_refreshed_at: string };
    expect(seg.created_at).toMatch(ISO_Z);
    expect(seg.updated_at).toMatch(ISO_Z);
    expect(seg.last_refreshed_at).toMatch(ISO_Z);
    // Parsed instant is fresh — not shifted by the UTC offset.
    expect(Math.abs(Date.now() - new Date(seg.created_at).getTime()) / 60000).toBeLessThan(1);
  });

  it('hydrateSegment leaves already-ISO timestamps untouched', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: { name: 'App-created cohort', type: 'manual' },
    });
    const id = created.json().id as string;
    // App writes ISO via new Date().toISOString(); must pass through unchanged.
    const seg = (await app.inject({ method: 'GET', url: `/api/segments/${id}` })).json() as {
      created_at: string;
    };
    expect(seg.created_at).toBe(created.json().created_at);
    expect(Number.isNaN(new Date(seg.created_at).getTime())).toBe(false);
  });
});
