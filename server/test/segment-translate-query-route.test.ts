/**
 * Route tests for POST /api/segments/translate-query — the segmentability probe
 * the chat "Build segment from this" bridge calls. Pure (no Cube/Trino), so this
 * verifies the FE-facing contract directly: direct-segmentable, the breakdown
 * seed path (carries grouping dimension + cube), and bare rejections.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

describe('POST /api/segments/translate-query', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let auth: { authorization: string };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    app = await buildApp();
    auth = {
      authorization: `Bearer ${await signAppJwt({ sub: 'alice-sub', username: 'alice-sub', email: 'alice@corp.com', role: 'editor' })}`,
    };
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  function call(query: unknown) {
    return app.inject({ method: 'POST', url: '/api/segments/translate-query', headers: auth, payload: { query } });
  }

  it('returns segmentable:true with a predicate_tree for a real row filter', async () => {
    const res = await call({
      dimensions: ['mf_users.payer_tier'],
      filters: [{ member: 'mf_users.country', operator: 'equals', values: ['VN'] }],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.segmentable).toBe(true);
    expect(body.cube).toBe('mf_users');
    expect(body.predicate_tree.children).toHaveLength(1);
  });

  it('an unfiltered breakdown is NOT directly segmentable but returns seed_dimensions + cube', async () => {
    const res = await call({
      measures: ['mf_users.paying_users', 'mf_users.ltv_total_vnd'],
      dimensions: ['mf_users.payer_tier'],
      order: { 'mf_users.ltv_total_vnd': 'desc' },
      limit: 10,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.segmentable).toBe(false);
    expect(body.reason).toBe('breakdown_unfiltered');
    expect(body.seed_dimensions).toEqual(['mf_users.payer_tier']);
    expect(body.cube).toBe('mf_users');
  });

  it('a filterless query with no dimensions is a bare rejection (no seed)', async () => {
    const res = await call({ measures: ['mf_users.user_count'] });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.segmentable).toBe(false);
    expect(body.reason).toBe('no_predicate');
    expect(body.seed_dimensions).toBeUndefined();
  });
});
