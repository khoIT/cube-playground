/**
 * DB-authoritative login + default-deny (keycloak-js session endpoint).
 *
 * Active grant → app JWT minted with DB role. Unknown/pending/disabled →
 * 403 ACCESS_PENDING + a pending row auto-created. KC `sub` reconciled on first
 * active login. The KC id_token JWKS verification is mocked so no network/realm
 * is needed — the default-deny logic under test is unchanged from the old
 * code-exchange route.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'auth-callback-test-'));
process.env.DB_PATH = join(tmp, 'auth.db');
process.env.AUTH_DISABLED = 'false';
process.env.JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';

// Mutable claims holder shared with the mocked exchange.
const h = vi.hoisted(() => ({
  claims: { sub: 'kc-sub', email: 'user@corp.com', preferred_username: 'user' } as {
    sub: string;
    email?: string;
    preferred_username?: string;
  },
}));

vi.mock('../src/services/keycloak-id-token-verify.js', () => ({
  verifyKeycloakIdToken: async () => h.claims,
}));

const { buildApp } = await import('../src/index.js');
const { getDb, closeDb } = await import('../src/db/sqlite.js');
const { getAccess, __resetAccessCache } = await import('../src/auth/access-store.js');
const { upsertUserAccess } = await import('../src/auth/access-store-mutators.js');

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().exec('DELETE FROM user_access;');
  __resetAccessCache();
  h.claims = { sub: 'kc-sub', email: 'user@corp.com', preferred_username: 'user' };
});

async function callback() {
  return app.inject({
    method: 'POST',
    url: '/api/auth/keycloak/session',
    payload: { idToken: 'fake.id.token' },
  });
}

describe('POST /api/auth/keycloak/session — default-deny', () => {
  it('unknown email → 403 + pending row created', async () => {
    const res = await callback();
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('ACCESS_PENDING');
    const rec = getAccess('user@corp.com');
    expect(rec?.status).toBe('pending');
    expect(rec?.kcSub).toBe('kc-sub');
  });

  it('pending email stays 403', async () => {
    upsertUserAccess({ email: 'user@corp.com', role: 'viewer', status: 'pending' });
    const res = await callback();
    expect(res.statusCode).toBe(403);
  });

  it('disabled email → 403', async () => {
    upsertUserAccess({ email: 'user@corp.com', role: 'editor', status: 'disabled' });
    const res = await callback();
    expect(res.statusCode).toBe(403);
  });

  it('active email → token with DB role + sub reconciled', async () => {
    upsertUserAccess({ email: 'user@corp.com', role: 'admin', status: 'active' });
    const res = await callback();
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { token: string; user: { role: string } };
    expect(body.token).toBeTruthy();
    expect(body.user.role).toBe('admin');
    expect(getAccess('user@corp.com')?.kcSub).toBe('kc-sub');
  });

  it('no email in claims → 403', async () => {
    h.claims = { sub: 'kc-sub', preferred_username: 'user' };
    const res = await callback();
    expect(res.statusCode).toBe(403);
  });
});
