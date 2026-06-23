/**
 * Global model override store — set/clear, persistence across a re-init
 * (restart), blank stored value falls back to none, and the
 * /internal/llm-auth-mode endpoint surfaces + mutates it alongside the key mode.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../src/config.js', () => ({
  config: {
    anthropicApiKey: 'key-primary',
    anthropicApiStgKey: '',
    anthropicApiBackupKey: '',
    anthropicSubscriptionOauthToken: 'sk-ant-oat-default',
    anthropicKeyRetryCooldownMs: 600_000,
    anthropicBaseUrl: 'https://gateway.example.test',
    allowedModels: ['claude-sonnet-4-6', 'claude-opus-4-8'],
    chatModel: 'claude-sonnet-4-6',
  },
  isLangfuseEnabled: () => false,
}));

import { migrate } from '../src/db/migrate.js';
import {
  initLlmModelOverride,
  getLlmModelOverride,
  setLlmModelOverride,
  __resetLlmModelOverrideForTests,
} from '../src/core/llm-model-override.js';
import { __resetLlmAuthModeForTests } from '../src/core/llm-auth-mode.js';
import { __resetKeyFailoverForTests } from '../src/core/anthropic-key-failover.js';
import internalLlmAuthRoutes from '../src/api/internal-llm-auth.js';

const SECRET = 'test-internal-secret';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

afterEach(() => {
  __resetLlmModelOverrideForTests();
  __resetLlmAuthModeForTests();
  __resetKeyFailoverForTests();
});

describe('llm-model-override store', () => {
  it('defaults to none; sets and clears', () => {
    expect(getLlmModelOverride()).toBeNull();
    setLlmModelOverride('claude-opus-4-8');
    expect(getLlmModelOverride()).toBe('claude-opus-4-8');
    setLlmModelOverride(null);
    expect(getLlmModelOverride()).toBeNull();
    setLlmModelOverride('claude-opus-4-8');
    setLlmModelOverride(''); // empty string clears
    expect(getLlmModelOverride()).toBeNull();
  });

  it('persists across a re-init (restart)', () => {
    const db = makeDb();
    initLlmModelOverride(db);
    setLlmModelOverride('claude-opus-4-8');

    __resetLlmModelOverrideForTests();
    expect(getLlmModelOverride()).toBeNull();
    initLlmModelOverride(db);
    expect(getLlmModelOverride()).toBe('claude-opus-4-8');
    db.close();
  });
});

describe('/internal/llm-auth-mode model field', () => {
  let app: FastifyInstance;

  async function build() {
    app = Fastify();
    await app.register(internalLlmAuthRoutes, { secretGate: { expectedSecret: SECRET } });
    await app.ready();
  }

  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET exposes the model override, allowed list, and default', async () => {
    await build();
    const res = await app.inject({
      method: 'GET',
      url: '/internal/llm-auth-mode',
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.modelOverride).toBeNull();
    expect(body.allowedModels).toEqual(['claude-sonnet-4-6', 'claude-opus-4-8']);
    expect(body.defaultModel).toBe('claude-sonnet-4-6');
  });

  it('PUT { model } sets the override; null clears it', async () => {
    await build();
    let res = await app.inject({
      method: 'PUT',
      url: '/internal/llm-auth-mode',
      headers: { 'x-internal-secret': SECRET },
      payload: { model: 'claude-opus-4-8' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().modelOverride).toBe('claude-opus-4-8');
    expect(getLlmModelOverride()).toBe('claude-opus-4-8');

    res = await app.inject({
      method: 'PUT',
      url: '/internal/llm-auth-mode',
      headers: { 'x-internal-secret': SECRET },
      payload: { model: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().modelOverride).toBeNull();
  });

  it('PUT 400s on a model outside the allowed list', async () => {
    await build();
    const res = await app.inject({
      method: 'PUT',
      url: '/internal/llm-auth-mode',
      headers: { 'x-internal-secret': SECRET },
      payload: { model: 'gpt-4o' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_model');
  });

  it('PUT 400s when neither mode nor model is provided', async () => {
    await build();
    const res = await app.inject({
      method: 'PUT',
      url: '/internal/llm-auth-mode',
      headers: { 'x-internal-secret': SECRET },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('no_change');
  });
});
