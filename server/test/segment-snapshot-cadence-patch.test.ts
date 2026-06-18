/**
 * PATCH /api/segments/:id — snapshot_cadence (capture cadence) setter.
 *
 * The lakehouse snapshot job reads snapshot_cadence to decide how often to
 * materialize a segment. The Movement tab sets it via PATCH; verify it
 * validates against the allowed set, persists (survives a re-read), defaults to
 * 'daily', and is independent of refresh_cadence_min.
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

describe('PATCH /api/segments/:id — snapshot_cadence', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let ownerAuth: { authorization: string };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    app = await buildApp();
    ownerAuth = {
      authorization: `Bearer ${await signAppJwt({ sub: 'alice-sub', username: 'alice-sub', email: 'alice@corp.com', role: 'editor' })}`,
    };
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  async function makeSegment(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: ownerAuth,
      payload: { name: 'cohort', type: 'manual', cube: 'mf_users', uid_list: ['u1'] },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  it('defaults to daily on a freshly created segment', async () => {
    const id = await makeSegment();
    const res = await app.inject({ method: 'GET', url: `/api/segments/${id}`, headers: ownerAuth });
    expect(res.json().snapshot_cadence).toBe('daily');
  });

  it('persists a valid cadence and survives a re-read', async () => {
    const id = await makeSegment();
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { snapshot_cadence: '1h' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().snapshot_cadence).toBe('1h');

    const reread = await app.inject({ method: 'GET', url: `/api/segments/${id}`, headers: ownerAuth });
    expect(reread.json().snapshot_cadence).toBe('1h');
  });

  it('rejects an out-of-set cadence value', async () => {
    const id = await makeSegment();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { snapshot_cadence: '7m' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('leaves refresh_cadence_min untouched when only snapshot_cadence changes', async () => {
    const id = await makeSegment();
    await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { refresh_cadence_min: 120 },
    });
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { snapshot_cadence: '6h' },
    });
    expect(patch.statusCode).toBe(200);
    const body = patch.json();
    expect(body.snapshot_cadence).toBe('6h');
    expect(body.refresh_cadence_min).toBe(120);
  });
});
