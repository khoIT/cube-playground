/**
 * admin-llm-auth route — verify the admin guards apply on this separate
 * Fastify plugin, graceful `status: null` on GET when the chat bridge is down
 * (no INTERNAL_SECRET here), PUT validation, and the 502 contract when a mode
 * switch can't reach chat-service (a toggle must never silently no-op).
 *
 * Real-auth mode so role enforcement is exercised, mirroring
 * admin-cost-route.test.ts.
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

describe('admin-llm-auth route (real-auth)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = {
    AUTH_DISABLED: process.env.AUTH_DISABLED,
    JWT_SECRET: process.env.JWT_SECRET,
    INTERNAL_SECRET: process.env.INTERNAL_SECRET,
  };
  let editorAuth: { authorization: string };
  let adminAuth: { authorization: string };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    delete process.env.INTERNAL_SECRET; // chat bridge "down" → graceful null / 502
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
    const anon = await app.inject({ method: 'GET', url: '/api/admin/llm-auth' });
    expect(anon.statusCode).toBe(401);

    const asEditor = await app.inject({ method: 'GET', url: '/api/admin/llm-auth', headers: editorAuth });
    expect(asEditor.statusCode).toBe(403);
  });

  it('GET degrades to status:null when the chat bridge is down (never 500s)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/llm-auth', headers: adminAuth });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { generatedAt: number; status: unknown };
    expect(body.status).toBeNull();
    expect(typeof body.generatedAt).toBe('number');
  });

  it('PUT 400s on an invalid mode', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/llm-auth',
      headers: adminAuth,
      payload: { mode: 'yolo' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT surfaces 400 (not 502) when the secret is missing — actionable misconfig', async () => {
    // setLlmAuthMode reports a configuration errorMessage when INTERNAL_SECRET
    // is unset, which the route maps to MODE_REJECTED — the admin sees why.
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/llm-auth',
      headers: adminAuth,
      payload: { mode: 'gateway' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.message).toContain('INTERNAL_SECRET');
  });
});
