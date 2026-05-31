/**
 * Integration tests for the connector edit/disable/audit HTTP surface.
 *
 * Asserts: editor can PATCH non-secret config + label; viewer → 403
 * (enforce-write-roles); the read-only worked example → 403; unknown id → 404;
 * disable drops it from the list and refuses the worked example; audit endpoint
 * returns the lifecycle trail. Real DB + vault key; registry write redirected to
 * a temp file so the repo's datasources.config.json is untouched.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const tmp = mkdtempSync(join(tmpdir(), 'connector-crud-test-'));
process.env.DB_PATH = join(tmp, 'crud.db');
process.env.DATASOURCES_CONFIG_PATH = join(tmp, 'datasources.config.json');
process.env.CONNECTOR_SECRET_KEY = randomBytes(32).toString('base64');
delete process.env.AUTH_DISABLED; // exercise the real write-role gate
process.env.AUTHZ_GRANT_FALLBACK = 'true';

import enforceWriteRoles from '../src/middleware/enforce-write-roles.js';
import onboardingRoutes from '../src/routes/onboarding.js';
import { getDb, closeDb } from '../src/db/sqlite.js';
import { __resetVaultKeyCache } from '../src/services/connector-secret-vault.js';
import { createConnector, getStoredConnector } from '../src/services/connector-store.js';
import type { AuthenticatedUser } from '../src/middleware/authenticate.js';

type Role = 'viewer' | 'editor' | 'admin';

function userFor(role: Role): AuthenticatedUser {
  return { id: role, username: role, email: `${role}@vng`, role, allowedGames: ['ballistar'], workspaces: [], features: {} };
}

async function buildTestApp(role: Role): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest('user', undefined);
  app.decorateRequest('owner', 'tester');
  app.decorateRequest('buildCubeCtxForGame', null);
  app.addHook('onRequest', async (req) => {
    (req as { user?: AuthenticatedUser }).user = userFor(role);
    (req as { buildCubeCtxForGame: unknown }).buildCubeCtxForGame = () => ({ cubeApiUrl: 'http://cube', token: 't' });
  });
  await app.register(enforceWriteRoles);
  await app.register(onboardingRoutes);
  await app.ready();
  return app;
}

const baseConfig = { host: 'h', port: 443, user: 'u', catalog: 'game_integration', ssl: true };

beforeEach(() => {
  __resetVaultKeyCache();
  getDb().exec('DELETE FROM connector_audit; DELETE FROM connectors;');
  createConnector({ id: 'c1', workspaceId: 'local', sourceType: 'trino', label: 'C1', config: { ...baseConfig }, secret: 'pw-original' });
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('PATCH /api/onboarding/connectors/:id', () => {
  it('lets an editor update non-secret config + label, keeping the secret when blank', async () => {
    const app = await buildTestApp('editor');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/onboarding/connectors/c1',
      payload: { label: 'Renamed', fields: { ...baseConfig, host: 'h2' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().connector.host).toBe('h2');
    // secret untouched (blank field) — verify via the store, never the wire.
    expect(getStoredConnector('c1')?.password).toBe('pw-original');
    await app.close();
  });

  it('rotates the secret when a new one is supplied', async () => {
    const app = await buildTestApp('editor');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/onboarding/connectors/c1',
      payload: { fields: { ...baseConfig, password: 'rotated' } },
    });
    expect(res.statusCode).toBe(200);
    expect(getStoredConnector('c1')?.password).toBe('rotated');
    await app.close();
  });

  it('403s a viewer (write-role gate)', async () => {
    const app = await buildTestApp('viewer');
    const res = await app.inject({ method: 'PATCH', url: '/api/onboarding/connectors/c1', payload: { fields: { ...baseConfig } } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('WRITE_FORBIDDEN');
    await app.close();
  });

  it('403s the read-only worked example', async () => {
    const app = await buildTestApp('editor');
    const res = await app.inject({ method: 'PATCH', url: '/api/onboarding/connectors/existing-model', payload: { fields: { ...baseConfig } } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('READ_ONLY');
    await app.close();
  });

  it('404s an unknown id', async () => {
    const app = await buildTestApp('editor');
    const res = await app.inject({ method: 'PATCH', url: '/api/onboarding/connectors/nope', payload: { fields: { ...baseConfig } } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('POST /api/onboarding/connectors/:id/disable', () => {
  it('disables an existing connector and drops it from the list', async () => {
    const app = await buildTestApp('editor');
    const res = await app.inject({ method: 'POST', url: '/api/onboarding/connectors/c1/disable' });
    expect(res.statusCode).toBe(200);
    expect(res.json().disabled).toBe(true);
    const list = await app.inject({ method: 'GET', url: '/api/onboarding/connectors' });
    expect(list.json().connectors.find((c: { id: string }) => c.id === 'c1')).toBeUndefined();
    await app.close();
  });

  it('403s disabling the read-only worked example', async () => {
    const app = await buildTestApp('editor');
    const res = await app.inject({ method: 'POST', url: '/api/onboarding/connectors/existing-model/disable' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('404s an unknown id', async () => {
    const app = await buildTestApp('editor');
    const res = await app.inject({ method: 'POST', url: '/api/onboarding/connectors/nope/disable' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('GET /api/onboarding/connectors/:id/audit', () => {
  it('returns the lifecycle audit trail', async () => {
    const app = await buildTestApp('editor');
    await app.inject({ method: 'PATCH', url: '/api/onboarding/connectors/c1', payload: { fields: { ...baseConfig } } });
    const res = await app.inject({ method: 'GET', url: '/api/onboarding/connectors/c1/audit' });
    expect(res.statusCode).toBe(200);
    const actions = res.json().audit.map((a: { action: string }) => a.action);
    expect(actions).toContain('create');
    expect(actions).toContain('update');
    await app.close();
  });
});
