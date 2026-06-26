/**
 * OpenAPI spec guard — the paginated JSON pull is documented on the members
 * operation: format=json + page_id params, and the 400/404/409 responses.
 * Guards against handler/spec drift.
 */

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
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

describe('openapi spec — paginated members', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it('documents format=json, page_id, and the 400/404/409 responses, tagged public', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();

    const path = Object.keys(spec.paths).find((p) => p.endsWith('/segments/{id}/members'));
    expect(path).toBeTruthy();
    const op = spec.paths[path!].get;

    expect(op.tags).toContain('public');

    const params = op.parameters as Array<{ name: string; schema?: { enum?: string[] } }>;
    const format = params.find((p) => p.name === 'format');
    expect(format?.schema?.enum).toContain('json');
    expect(format?.schema?.enum).toContain('csv_paged');
    expect(params.some((p) => p.name === 'page_id')).toBe(true);

    expect(op.responses['400']).toBeTruthy();
    expect(op.responses['404']).toBeTruthy();
    expect(op.responses['409']).toBeTruthy();

    // 200 documents the page shape.
    const ok200 = op.responses['200'];
    const schema200 = ok200.content?.['application/json']?.schema ?? ok200.schema;
    expect(schema200?.properties).toHaveProperty('page_id');
    expect(schema200?.properties).toHaveProperty('has_more');
  });
});
