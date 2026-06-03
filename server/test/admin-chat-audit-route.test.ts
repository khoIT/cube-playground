/**
 * Admin chat-audit routes — cross-user read access to another user's chat data.
 *
 * Guards: real-auth mode (AUTH_DISABLED='false') to verify role and feature
 * enforcement fires. Chat-service calls are intercepted by replacing the global
 * fetch with a stub — no live chat-service needed.
 *
 * Coverage:
 *   - 401 unauthenticated
 *   - 403 non-admin (editor role)
 *   - 400 missing email param
 *   - 404 unknown target email
 *   - 200 admin + valid target — asserts TARGET user's sub reaches chat-service,
 *     not the admin's own sub
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

/** Minimal Response stub returned by the fake chat-service fetch. */
function makeFakeResponse(body: unknown, status = 200): Response {
  const json = JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
    json: async () => JSON.parse(json),
    text: async () => json,
  } as unknown as Response;
}

describe('admin-chat-audit routes (real-auth)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = {
    AUTH_DISABLED: process.env.AUTH_DISABLED,
    JWT_SECRET: process.env.JWT_SECRET,
    CHAT_FEATURE_ENABLED: process.env.CHAT_FEATURE_ENABLED,
    CHAT_SERVICE_URL: process.env.CHAT_SERVICE_URL,
  };
  let editorAuth: { authorization: string };
  let adminAuth: { authorization: string };

  // Track outbound fetch calls to the stub chat-service.
  let lastFetchedUrl: string | null = null;
  let lastFetchedOwnerId: string | null = null;
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.CHAT_FEATURE_ENABLED = 'true';
    process.env.CHAT_SERVICE_URL = 'http://chat-stub.internal';

    setDb(makeMemDb());
    __resetAccessCache();

    // Provision users: one editor, one admin, one target user with a known sub.
    upsertUserAccess({ email: 'editor@corp.com', role: 'editor', status: 'active' });
    upsertUserAccess({ email: 'admin@corp.com', role: 'admin', status: 'active' });
    upsertUserAccess({ email: 'target@corp.com', role: 'viewer', status: 'active' });
    getDb().prepare('UPDATE user_access SET kc_sub = ? WHERE email = ?').run('admin-sub-001', 'admin@corp.com');
    getDb().prepare('UPDATE user_access SET kc_sub = ? WHERE email = ?').run('target-sub-999', 'target@corp.com');

    // Inject a fetch stub so admin-chat-audit proxy calls never hit the network.
    lastFetchedUrl = null;
    lastFetchedOwnerId = null;
    fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      lastFetchedUrl = urlStr;
      lastFetchedOwnerId = (init?.headers as Record<string, string>)?.['X-Owner-Id'] ?? null;
      // Return a realistic stub payload for sessions list.
      return makeFakeResponse({ sessions: [] });
    });
    // Replace global fetch for this test suite (restored in afterEach).
    vi.stubGlobal('fetch', fetchStub);

    app = await buildApp();

    editorAuth = {
      authorization: `Bearer ${await signAppJwt({ sub: 'editor-sub', username: 'editor', email: 'editor@corp.com', role: 'editor' })}`,
    };
    adminAuth = {
      authorization: `Bearer ${await signAppJwt({ sub: 'admin-sub-001', username: 'admin', email: 'admin@corp.com', role: 'admin' })}`,
    };
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    vi.unstubAllGlobals();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
    process.env.CHAT_FEATURE_ENABLED = prev.CHAT_FEATURE_ENABLED;
    process.env.CHAT_SERVICE_URL = prev.CHAT_SERVICE_URL;
  });

  // ---- /api/admin/chat/sessions -----------------------------------------------

  describe('GET /api/admin/chat/sessions', () => {
    it('401 unauthenticated', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/sessions?email=target@corp.com',
      });
      expect(res.statusCode).toBe(401);
    });

    it('403 for non-admin editor', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/sessions?email=target@corp.com',
        headers: editorAuth,
      });
      expect(res.statusCode).toBe(403);
    });

    it('400 when email param is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/sessions',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { code: string };
      expect(body.code).toBe('missing_email');
    });

    it('404 for unknown target email', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/sessions?email=nobody@corp.com',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(404);
      const body = res.json() as { code: string };
      expect(body.code).toBe('unknown_target_user');
    });

    it('404 when target user has no kc_sub (never logged in)', async () => {
      // Add a user without a sub.
      upsertUserAccess({ email: 'nosub@corp.com', role: 'viewer', status: 'active' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/sessions?email=nosub@corp.com',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(404);
      const body = res.json() as { code: string };
      expect(body.code).toBe('unknown_target_user');
    });

    it('200 for admin — proxies using TARGET user sub, not admin sub', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/sessions?email=target@corp.com&game=muaw',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(200);

      // Verify the fetch went to the right chat-service URL.
      expect(lastFetchedUrl).toContain('/debug/sessions');
      expect(lastFetchedUrl).toContain('game=muaw');

      // The critical invariant: X-Owner-Id must be the TARGET's sub, not the admin's.
      expect(lastFetchedOwnerId).toBe('target-sub-999');
      expect(lastFetchedOwnerId).not.toBe('admin-sub-001');
    });

    it('200 with optional query params forwarded', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/sessions?email=target@corp.com&game=muaw&q=hello&limit=5',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(200);
      expect(lastFetchedUrl).toContain('q=hello');
      expect(lastFetchedUrl).toContain('limit=5');
    });
  });

  // ---- /api/admin/chat/sessions/:id -------------------------------------------

  describe('GET /api/admin/chat/sessions/:id', () => {
    it('401 unauthenticated', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/sessions/sess-abc?email=target@corp.com',
      });
      expect(res.statusCode).toBe(401);
    });

    it('403 for non-admin editor', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/sessions/sess-abc?email=target@corp.com',
        headers: editorAuth,
      });
      expect(res.statusCode).toBe(403);
    });

    it('400 when email param is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/sessions/sess-abc',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(400);
    });

    it('404 for unknown target email', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/sessions/sess-abc?email=nobody@corp.com',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(404);
    });

    it('200 for admin — X-Owner-Id is target sub', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/sessions/sess-abc?email=target@corp.com',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(200);
      expect(lastFetchedUrl).toContain('/debug/sessions/sess-abc');
      expect(lastFetchedOwnerId).toBe('target-sub-999');
    });
  });

  // ---- /api/admin/chat/turns/:turnId ------------------------------------------

  describe('GET /api/admin/chat/turns/:turnId', () => {
    it('401 unauthenticated', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/turns/turn-xyz?email=target@corp.com',
      });
      expect(res.statusCode).toBe(401);
    });

    it('403 for non-admin editor', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/turns/turn-xyz?email=target@corp.com',
        headers: editorAuth,
      });
      expect(res.statusCode).toBe(403);
    });

    it('400 when email param is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/turns/turn-xyz',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(400);
    });

    it('404 for unknown target email', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/turns/turn-xyz?email=nobody@corp.com',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(404);
    });

    it('200 for admin — X-Owner-Id is target sub, URL contains turnId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/turns/turn-xyz?email=target@corp.com',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(200);
      expect(lastFetchedUrl).toContain('/debug/turns/turn-xyz');
      expect(lastFetchedOwnerId).toBe('target-sub-999');
    });
  });

  // ---- Chat-service down (502 graceful degradation) ---------------------------

  describe('graceful degradation when chat-service is down', () => {
    it('returns 502 when fetch throws (network error)', async () => {
      fetchStub.mockImplementationOnce(async () => {
        throw new Error('ECONNREFUSED');
      });
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/sessions?email=target@corp.com',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(502);
      const body = res.json() as { code: string };
      expect(body.code).toBe('upstream_unreachable');
    });

    it('forwards non-200 status from chat-service verbatim', async () => {
      fetchStub.mockImplementationOnce(async () => makeFakeResponse({ error: 'not found' }, 404));
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/chat/sessions?email=target@corp.com',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
