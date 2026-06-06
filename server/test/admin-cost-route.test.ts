/**
 * admin-cost route — verify the admin guards apply on this SEPARATE Fastify
 * plugin (encapsulation: no inherited hooks), graceful `breakdown: null` when
 * the chat bridge is down (no INTERNAL_SECRET here), and bad-date validation.
 *
 * Real-auth mode so role enforcement is exercised (dev synth-admin would
 * bypass it). The sub→email enrichment path is pure mapping over the
 * chat-service payload and is covered by the chat-side internal-cost tests +
 * this route's contract.
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

describe('admin-cost route (real-auth)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET, INTERNAL_SECRET: process.env.INTERNAL_SECRET };
  let editorAuth: { authorization: string };
  let adminAuth: { authorization: string };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    delete process.env.INTERNAL_SECRET; // chat bridge "down" → graceful null
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'editor@corp.com', role: 'editor', status: 'active' });
    upsertUserAccess({ email: 'admin@corp.com', role: 'admin', status: 'active' });
    app = await buildApp();
    editorAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'editor-sub', username: 'editor', email: 'editor@corp.com', role: 'editor' })}` };
    adminAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'admin-sub', username: 'admin', email: 'admin@corp.com', role: 'admin' })}` };
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
    if (prev.INTERNAL_SECRET === undefined) delete process.env.INTERNAL_SECRET;
    else process.env.INTERNAL_SECRET = prev.INTERNAL_SECRET;
  });

  it('401 unauthenticated, 403 for a non-admin', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/admin/cost/summary' });
    expect(anon.statusCode).toBe(401);

    const asEditor = await app.inject({ method: 'GET', url: '/api/admin/cost/summary', headers: editorAuth });
    expect(asEditor.statusCode).toBe(403);
  });

  it('200 for admin with breakdown:null when the chat bridge is down (never 500s)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/cost/summary', headers: adminAuth });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { generatedAt: number; breakdown: unknown };
    expect(body.breakdown).toBeNull();
    expect(typeof body.generatedAt).toBe('number');
  });

  it('400s on a malformed date', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/cost/summary?from=not-a-date', headers: adminAuth });
    expect(res.statusCode).toBe(400);
  });
});
