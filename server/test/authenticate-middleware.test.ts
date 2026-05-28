import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';

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

const JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';

describe('authenticate middleware', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prevAuthDisabled = process.env.AUTH_DISABLED;
  const prevJwtSecret = process.env.JWT_SECRET;

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prevAuthDisabled;
    process.env.JWT_SECRET = prevJwtSecret;
  });

  describe('AUTH_DISABLED=true', () => {
    beforeEach(async () => {
      process.env.AUTH_DISABLED = 'true';
      process.env.JWT_SECRET = JWT_SECRET;
      setDb(makeMemDb());
      app = await buildApp();
    });

    it('/api/auth/me returns the synthesized dev user', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user.id).toBe('dev');
      expect(body.user.role).toBe('admin');
      expect(body.user.allowedGames).toContain('ballistar');
    });

    it('/api/auth/keycloak/config returns enabled=false', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/keycloak/config' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ enabled: false });
    });

    it('still honours X-Owner override for back-compat', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/segments',
        payload: { name: 'OwnedSeg', type: 'manual' },
        headers: { 'x-owner': 'alice' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().owner).toBe('alice');
    });
  });

  describe('AUTH_DISABLED=false (real auth)', () => {
    beforeEach(async () => {
      process.env.AUTH_DISABLED = 'false';
      process.env.JWT_SECRET = JWT_SECRET;
      setDb(makeMemDb());
      app = await buildApp();
    });

    it('/api/auth/me 401s without a Bearer token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
      expect(res.statusCode).toBe(401);
    });

    it('/api/auth/me 401s with a bogus Bearer token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: 'Bearer not-a-real-jwt' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('/api/auth/me returns the verified user for a valid JWT', async () => {
      const token = await signAppJwt({
        sub: 'kc-uuid-editor',
        username: 'editor',
        role: 'editor',
        allowedGames: ['ballistar', 'cfm_vn'],
      });
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user).toEqual({
        id: 'kc-uuid-editor',
        username: 'editor',
        email: undefined,
        role: 'editor',
        allowedGames: ['ballistar', 'cfm_vn'],
      });
    });
  });
});
