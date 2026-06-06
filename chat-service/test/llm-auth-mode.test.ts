/**
 * LLM auth-mode store + /internal/llm-auth-mode endpoint.
 *
 * Proves: mode persists to kv_cache and survives a re-init (restart),
 * corrupt/unknown stored values fall back to 'auto', the secret gate rejects
 * without a valid x-internal-secret, PUT validates the requested lane against
 * configured credentials, and the failover ladder honours the mode filter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../src/config.js', () => ({
  config: {
    anthropicApiKey: 'key-primary',
    anthropicApiStgKey: 'key-stg',
    anthropicApiBackupKey: '',
    anthropicSubscriptionOauthToken: 'sk-ant-oat-subscription',
    anthropicKeyRetryCooldownMs: 600_000,
    anthropicBaseUrl: 'https://gateway.example.test',
  },
  isLangfuseEnabled: () => false,
}));

import { migrate } from '../src/db/migrate.js';
import {
  initLlmAuthMode,
  getLlmAuthMode,
  setLlmAuthMode,
  isLlmAuthMode,
  __resetLlmAuthModeForTests,
} from '../src/core/llm-auth-mode.js';
import {
  getActiveAnthropicKey,
  anthropicKeyCount,
  keyFailoverStatus,
  __resetKeyFailoverForTests,
} from '../src/core/anthropic-key-failover.js';
import internalLlmAuthRoutes from '../src/api/internal-llm-auth.js';

const SECRET = 'test-internal-secret';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

afterEach(() => {
  __resetLlmAuthModeForTests();
  __resetKeyFailoverForTests();
});

describe('llm-auth-mode store', () => {
  it('defaults to auto; validates values', () => {
    expect(getLlmAuthMode()).toBe('auto');
    expect(isLlmAuthMode('gateway')).toBe(true);
    expect(isLlmAuthMode('nope')).toBe(false);
    expect(() => setLlmAuthMode('nope' as never)).toThrow();
  });

  it('persists to kv_cache and survives a re-init (restart)', () => {
    const db = makeDb();
    initLlmAuthMode(db);
    setLlmAuthMode('subscription');

    // Simulate restart: fresh module state, same DB.
    __resetLlmAuthModeForTests();
    expect(getLlmAuthMode()).toBe('auto');
    initLlmAuthMode(db);
    expect(getLlmAuthMode()).toBe('subscription');
    db.close();
  });

  it('falls back to auto on a corrupt stored value', () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO kv_cache (kind, key, value_json, created_at) VALUES ('runtime_setting', 'llm_auth_mode', ?, 0)`,
    ).run(JSON.stringify('not-a-mode'));
    initLlmAuthMode(db);
    expect(getLlmAuthMode()).toBe('auto');
    db.close();
  });
});

describe('failover ladder honours the mode', () => {
  beforeEach(() => {
    __resetKeyFailoverForTests();
    __resetLlmAuthModeForTests();
  });

  it("'gateway' filters out the subscription slot", () => {
    setLlmAuthMode('gateway');
    expect(anthropicKeyCount()).toBe(2); // primary + stg
    expect(getActiveAnthropicKey().authKind).toBe('gateway-key');
    expect(keyFailoverStatus().mode).toBe('gateway');
  });

  it("'subscription' pins to the OAuth slot", () => {
    setLlmAuthMode('subscription');
    expect(anthropicKeyCount()).toBe(1);
    expect(getActiveAnthropicKey()).toEqual({
      key: 'sk-ant-oat-subscription',
      label: 'subscription',
      authKind: 'oauth-token',
    });
  });

  it("'auto' uses the full ladder", () => {
    expect(anthropicKeyCount()).toBe(3);
    expect(getActiveAnthropicKey().label).toBe('primary');
  });
});

describe('/internal/llm-auth-mode endpoint', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    __resetLlmAuthModeForTests();
    __resetKeyFailoverForTests();
    app = Fastify();
    await app.register(internalLlmAuthRoutes, { secretGate: { expectedSecret: SECRET } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('401s without the secret', async () => {
    const res = await app.inject({ method: 'GET', url: '/internal/llm-auth-mode' });
    expect(res.statusCode).toBe(401);
  });

  it('GET returns the mode + key status (labels only)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/internal/llm-auth-mode',
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('auto');
    expect(body.keys.configured).toEqual(['primary', 'stg', 'subscription']);
    expect(JSON.stringify(body)).not.toContain('key-primary');
    expect(JSON.stringify(body)).not.toContain('sk-ant-oat');
  });

  it('PUT switches the mode and the ladder follows', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/internal/llm-auth-mode',
      headers: { 'x-internal-secret': SECRET },
      payload: { mode: 'subscription' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('subscription');
    expect(getActiveAnthropicKey().label).toBe('subscription');
  });

  it('PUT 400s on an invalid mode', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/internal/llm-auth-mode',
      headers: { 'x-internal-secret': SECRET },
      payload: { mode: 'yolo' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_mode');
  });
});
