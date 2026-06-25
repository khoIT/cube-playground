/**
 * Public API docs surface: one OpenAPI spec, two renderers.
 *
 * Asserts the raw spec carries the consumer-guide externalDocs link (so BOTH
 * renderers surface it), and that Scalar (/docs) and Swagger UI (/docs/swagger)
 * both serve. Only tagged ('public') operations appear — the spec must not leak
 * the internal surface.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { setDb, closeDb } from '../src/db/sqlite.js';
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

describe('public API docs surface', () => {
  let app: Awaited<ReturnType<typeof import('../src/index.js').buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    const { buildApp } = await import('../src/index.js');
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it('serves an OpenAPI spec with the consumer-guide externalDocs link', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.externalDocs?.url).toContain('claude.ai/code/artifact/');
    // Only documented (tagged) public routes surface — no internal leakage.
    const tagged = Object.values(spec.paths ?? {}).flatMap((p: any) => Object.values(p));
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged.every((op: any) => (op.tags ?? []).includes('public'))).toBe(true);
  });

  it('serves Scalar at /docs and Swagger UI at /docs/swagger', async () => {
    const scalarRes = await app.inject({ method: 'GET', url: '/docs' });
    expect([200, 301, 302]).toContain(scalarRes.statusCode);

    // Swagger UI redirects the bare prefix to the trailing-slash index.
    const swaggerRes = await app.inject({ method: 'GET', url: '/docs/swagger/' });
    expect(swaggerRes.statusCode).toBe(200);
    expect(swaggerRes.body).toContain('swagger-ui');
  });
});
