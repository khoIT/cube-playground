import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // Apply all migrations in order so new tables/columns don't break older tests.
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

describe('owner-header middleware', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  // Post-Phase-6: when AUTH_DISABLED=true and no X-Owner is provided, the
  // authenticate middleware synthesizes the dev-admin user (first bootstrap admin) — replacing the prior
  // 'anonymous' fallback. The X-Owner override still wins when supplied.
  it('falls back to dev-user id when X-Owner header is missing (AUTH_DISABLED)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: { name: 'Test', type: 'manual' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().owner).toBe('khoitn@vng.com.vn');
  });

  it('falls back to dev-user id when X-Owner is an empty string (AUTH_DISABLED)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: { name: 'Test2', type: 'manual' },
      headers: { 'x-owner': '' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().owner).toBe('khoitn@vng.com.vn');
  });

  it('passes through a provided X-Owner header value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: { name: 'OwnedSeg', type: 'manual' },
      headers: { 'x-owner': 'alice' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().owner).toBe('alice');
  });

  it('trims whitespace from X-Owner', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: { name: 'TrimSeg', type: 'manual' },
      headers: { 'x-owner': '  bob  ' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().owner).toBe('bob');
  });
});
