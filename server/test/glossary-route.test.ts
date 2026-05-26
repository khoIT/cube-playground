import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setDb, closeDb } from '../src/db/sqlite.js';
import glossaryRoutes from '../src/routes/glossary.js';
import { migrateGlossarySeed } from '../src/db/glossary-migrate.js';

function readMigration(filename: string): string {
  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, `src/db/migrations/${filename}`),
    resolve(cwd, `server/src/db/migrations/${filename}`),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, 'utf-8');
    } catch {
      continue;
    }
  }
  throw new Error(`${filename} migration not found`);
}

function inMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readMigration('007-glossary.sql'));
  db.exec(readMigration('008-glossary-bilingual-and-status.sql'));
  db.exec(readMigration('015-glossary-concept-tier.sql'));
  return db;
}

describe('GET /api/glossary', () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    closeDb();
    db = inMemoryDb();
    setDb(db);
    migrateGlossarySeed(db);
    app = Fastify();
    await app.register(glossaryRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it('returns seeded canonical terms', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/glossary' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { terms: Array<{ id: string }> };
    expect(body.terms.length).toBeGreaterThan(20);
    expect(body.terms.find((t) => t.id === 'dau')).toBeTruthy();
    expect(body.terms.find((t) => t.id === 'whale')).toBeTruthy();
  });

  it('returns 404 for unknown term', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/glossary/__nope__' });
    expect(res.statusCode).toBe(404);
  });

  it('returns a single term', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/glossary/dau' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; label: string };
    expect(body.id).toBe('dau');
    expect(body.label).toBe('DAU');
  });
});
