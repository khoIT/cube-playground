import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const sql = readFileSync(join(__dirname, '../src/db/migrations/001-init.sql'), 'utf8');
  db.exec(sql);
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

  it('sets request.owner to "anonymous" when X-Owner header is missing', async () => {
    // POST a segment without X-Owner; the created row should have owner='anonymous'
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: { name: 'Test', type: 'manual' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.owner).toBe('anonymous');
  });

  it('sets request.owner to "anonymous" when X-Owner is an empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: { name: 'Test2', type: 'manual' },
      headers: { 'x-owner': '' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().owner).toBe('anonymous');
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
