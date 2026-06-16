/**
 * Integration tests for GET /api/query-perf/{failures,recent,summary}.
 *
 * Real-auth mode (AUTH_DISABLED=false) with JWT-signed admin/editor tokens to
 * exercise requireRole('admin'). Asserts non-admin → 403, and that a seeded
 * 504 surfaces under /failures while a 200 surfaces under /recent.
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
import { insertQueryPerf } from '../src/services/query-perf-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const JWT_SECRET = 'test-jwt-secret-query-perf-16char';

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

describe('query-perf routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminAuth: { authorization: string };
  let editorAuth: { authorization: string };
  let db: Database.Database;

  const prevEnv = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;

    db = makeMemDb();
    setDb(db);
    __resetAccessCache();

    upsertUserAccess({ email: 'admin@corp.com', role: 'admin', status: 'active' });
    upsertUserAccess({ email: 'editor@corp.com', role: 'editor', status: 'active' });
    db.prepare('UPDATE user_access SET kc_sub = ? WHERE email = ?').run('admin-sub', 'admin@corp.com');
    db.prepare('UPDATE user_access SET kc_sub = ? WHERE email = ?').run('editor-sub', 'editor@corp.com');

    adminAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'admin-sub', email: 'admin@corp.com', role: 'admin' }, JWT_SECRET)}` };
    editorAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'editor-sub', email: 'editor@corp.com', role: 'editor' }, JWT_SECRET)}` };

    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prevEnv.AUTH_DISABLED;
    process.env.JWT_SECRET = prevEnv.JWT_SECRET;
  });

  function seed() {
    insertQueryPerf(db, {
      actorSub: 'admin-sub', actorEmail: 'admin@corp.com', workspace: 'local', game: 'cfm_vn',
      method: 'POST', status: 504, latencyMs: 30500,
      query: { dimensions: ['mf_users.user_id'], measures: ['mf_users.count'] },
      errorBody: { error: 'Cube request timed out after 30s' }, ts: 2000,
    });
    insertQueryPerf(db, {
      actorSub: 'admin-sub', actorEmail: 'admin@corp.com', workspace: 'local', game: 'cfm_vn',
      method: 'POST', status: 200, latencyMs: 120,
      query: { measures: ['active_daily.dau'], timeDimensions: [{ dimension: 'active_daily.log_date' }] },
      usedPreaggs: ['active_daily.dau_batch'], ts: 1000,
    });
  }

  it('403 for non-admin on all read routes', async () => {
    for (const url of ['/api/query-perf/failures', '/api/query-perf/recent', '/api/query-perf/summary']) {
      const res = await app.inject({ method: 'GET', url, headers: editorAuth });
      expect(res.statusCode).toBe(403);
    }
  });

  it('failures returns the 504 with red-flag fields, NAMES only', async () => {
    seed();
    const res = await app.inject({ method: 'GET', url: '/api/query-perf/failures', headers: adminAuth });
    expect(res.statusCode).toBe(200);
    const { rows } = res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(504);
    expect(rows[0].latencyMs).toBe(30500);
    expect(rows[0].errorExcerpt).toContain('timed out');
    expect(rows[0].shape.dimensions).toContain('mf_users.user_id');
  });

  it('recent returns only the 200 with used pre-aggs', async () => {
    seed();
    const res = await app.inject({ method: 'GET', url: '/api/query-perf/recent', headers: adminAuth });
    const { rows } = res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(200);
    expect(rows[0].usedPreaggs).toEqual(['active_daily.dau_batch']);
  });

  it('summary KPIs match seeded rows', async () => {
    seed();
    const res = await app.inject({ method: 'GET', url: '/api/query-perf/summary', headers: adminAuth });
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.failures).toBe(1);
  });

  it('suggestion for the root-cause row → materialize-snapshot, needsLlm false', async () => {
    seed();
    const { rows } = (await app.inject({ method: 'GET', url: '/api/query-perf/failures', headers: adminAuth })).json();
    const res = await app.inject({ method: 'GET', url: `/api/query-perf/${rows[0].id}/suggestion`, headers: adminAuth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.best.id).toBe('materialize-snapshot');
    expect(body.needsLlm).toBe(false);
  });

  it('llm-suggest is 409 when a playbook is available (LLM reserved for the gap)', async () => {
    seed();
    const { rows } = (await app.inject({ method: 'GET', url: '/api/query-perf/failures', headers: adminAuth })).json();
    const res = await app.inject({ method: 'POST', url: `/api/query-perf/${rows[0].id}/llm-suggest`, headers: adminAuth });
    expect(res.statusCode).toBe(409);
  });
});
