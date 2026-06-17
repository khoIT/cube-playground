import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setDb, closeDb } from '../src/db/sqlite.js';
import glossaryRoutes from '../src/routes/glossary.js';
import { migrateGlossarySeed } from '../src/db/glossary-migrate.js';

function readMigration(filename: string): string {
  for (const p of [
    resolve(process.cwd(), `src/db/migrations/${filename}`),
    resolve(process.cwd(), `server/src/db/migrations/${filename}`),
  ]) {
    try { return readFileSync(p, 'utf-8'); } catch { continue; }
  }
  throw new Error(`${filename} not found`);
}

function inMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readMigration('007-glossary.sql'));
  db.exec(readMigration('008-glossary-bilingual-and-status.sql'));
  db.exec(readMigration('015-glossary-concept-tier.sql'));
  db.exec(readMigration('027-glossary-unified-trust-visibility.sql'));
  return db;
}

describe('glossary — unified trust/visibility + typed refs', () => {
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

  it('derives unified trust/visibility on read (whale = certified, org)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/glossary/whale' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { trust: string; visibility: string };
    expect(body.trust).toBe('certified');
    expect(body.visibility).toBe('org');
  });

  it('a freshly created user term reads as draft / org', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/glossary',
      payload: { label: 'Test Concept', description: 'a test term' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { trust: string; visibility: string; status: string };
    expect(body.status).toBe('draft');
    expect(body.trust).toBe('draft');
    expect(body.visibility).toBe('org');
  });

  it('rejects a secondary ref with an unknown namespace (grammar)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/glossary',
      payload: { label: 'Bad Ref', description: 'x', secondaryCatalogIds: ['glossary/whale'] },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('bad_request');
  });

  it('rejects a well-formed but dangling business_metrics ref', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/glossary',
      payload: { label: 'Dangling', description: 'x', secondaryCatalogIds: ['business_metrics/__nope__'] },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('dangling_ref');
  });

  it('rejects a dangling PRIMARY business_metrics ref (symmetric with secondary)', async () => {
    // The dead-chat-chip-link class: a term whose primary_catalog_id points at a
    // metric that doesn't exist. Primary refs drive the click target, so they
    // must be existence-checked on write just like secondary refs.
    const res = await app.inject({
      method: 'POST',
      url: '/api/glossary',
      payload: { label: 'Churny', description: 'x', primaryCatalogId: 'business_metrics/__nope__' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { code: string; refs: string[] };
    expect(body.code).toBe('dangling_ref');
    expect(body.refs).toContain('business_metrics/__nope__');
  });

  it('accepts an untyped (bare cube member) primary ref — grammar-only, not existence-checked', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/glossary',
      payload: { label: 'Bare Member', description: 'x', primaryCatalogId: 'mf_users.country' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('/api/glossary/integrity reports dangling refs in seeded terms', async () => {
    // churn_rate is seeded with primary business_metrics/churn_rate; with the
    // metric registry cache empty in this harness, it surfaces as dangling.
    const res = await app.inject({ method: 'GET', url: '/api/glossary/integrity' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { dangling: Array<{ termId: string; slot: string; ref: string }> };
    expect(Array.isArray(body.dangling)).toBe(true);
    expect(body.dangling.some((d) => d.termId === 'churn_rate' && d.slot === 'primary')).toBe(true);
  });

  it('?trust=certified aliases ?status=official', async () => {
    const certified = await app.inject({ method: 'GET', url: '/api/glossary?trust=certified' });
    const official = await app.inject({ method: 'GET', url: '/api/glossary?status=official' });
    expect(certified.statusCode).toBe(200);
    const a = (certified.json() as { terms: unknown[] }).terms.length;
    const b = (official.json() as { terms: unknown[] }).terms.length;
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
  });
});
