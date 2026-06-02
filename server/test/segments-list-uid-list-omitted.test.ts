/**
 * Regression: the segments LIST route must NOT hydrate uid_list.
 *
 * uid_list_json can be megabytes (cohorts of millions of uids); JSON.parse is
 * synchronous, so parsing every row on the single Node thread blocked the event
 * loop and starved all concurrent requests. The list now returns uid_count only
 * (uid_list = []); the full uid array is served by the per-segment detail route.
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

describe('GET /api/segments — uid_list omission', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it('omits uid_list on the list (uid_count only) but returns it on detail', async () => {
    // Create through the route so workspace/owner are set exactly as the server
    // resolves them, then attach a large uid list directly in the DB.
    const created = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: { name: 'Big cohort', type: 'manual' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const uids = Array.from({ length: 1000 }, (_, i) => `u${i}`);
    getDb()
      .prepare('UPDATE segments SET uid_list_json = ?, uid_count = ? WHERE id = ?')
      .run(JSON.stringify(uids), uids.length, id);

    // List: uid_count present, uid_list empty, raw blob never shipped.
    const list = await app.inject({ method: 'GET', url: '/api/segments' });
    expect(list.statusCode).toBe(200);
    const row = (list.json() as Array<Record<string, unknown>>).find((s) => s.id === id);
    expect(row).toBeDefined();
    expect(row!.uid_count).toBe(1000);
    expect(row!.uid_list).toEqual([]);
    expect(row!).not.toHaveProperty('uid_list_json');

    // Detail: full uid_list hydrated.
    const detail = await app.inject({ method: 'GET', url: `/api/segments/${id}` });
    expect(detail.statusCode).toBe(200);
    expect((detail.json().uid_list as string[]).length).toBe(1000);
    expect(detail.json()).not.toHaveProperty('uid_list_json');
  });
});
