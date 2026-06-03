/**
 * admin-activity routes — verify the admin guards actually apply on this
 * SEPARATE Fastify plugin (Fastify encapsulation: it does not inherit
 * admin-access.ts's scoped hooks), and the payload shapes.
 *
 * Real-auth mode so role enforcement is exercised (dev synth-admin would
 * bypass it). Chat-service is unreachable here (no INTERNAL_SECRET) so the
 * aggregator degrades to null chat counts — proving the route doesn't 500/hang
 * when chat is down.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, getDb, closeDb } from '../src/db/sqlite.js';
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

describe('admin-activity routes (real-auth)', () => {
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
    getDb().prepare('UPDATE user_access SET kc_sub = ? WHERE email = ?').run('admin-sub', 'admin@corp.com');
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

  it('summary: 401 unauthenticated, 403 for a non-admin, 200 for admin', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/admin/activity/summary' });
    expect(anon.statusCode).toBe(401);

    const asEditor = await app.inject({ method: 'GET', url: '/api/admin/activity/summary', headers: editorAuth });
    expect(asEditor.statusCode).toBe(403);

    const asAdmin = await app.inject({ method: 'GET', url: '/api/admin/activity/summary', headers: adminAuth });
    expect(asAdmin.statusCode).toBe(200);
    const body = asAdmin.json() as { usersByStatus: Record<string, number>; totalChatTurns: number | null };
    expect(body.usersByStatus.active).toBe(2);
    expect(body.totalChatTurns).toBeNull(); // chat bridge down → graceful
  });

  it('per-user: 403 for non-admin; 200 + shape for admin; 404 for unknown user', async () => {
    const asEditor = await app.inject({ method: 'GET', url: '/api/admin/activity/users/admin@corp.com', headers: editorAuth });
    expect(asEditor.statusCode).toBe(403);

    const ok = await app.inject({ method: 'GET', url: '/api/admin/activity/users/admin@corp.com', headers: adminAuth });
    expect(ok.statusCode).toBe(200);
    const user = ok.json() as { email: string; sub: string | null; chatStats: unknown };
    expect(user.email).toBe('admin@corp.com');
    expect(user.sub).toBe('admin-sub');
    expect(user.chatStats).toBeNull();

    const unknown = await app.inject({ method: 'GET', url: '/api/admin/activity/users/nobody@corp.com', headers: adminAuth });
    expect(unknown.statusCode).toBe(404);
  });
});
