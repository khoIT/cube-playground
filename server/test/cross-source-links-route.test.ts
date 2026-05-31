/**
 * Integration tests for the cross-source-links HTTP surface.
 *
 * Asserts: editor declares a link (201 + advisory verdict, never executable);
 * GET lists with verdicts; same-connector → 400 SAME_SOURCE (steer to executable
 * join); unknown connector → 404; DELETE soft-removes; viewer blocked on writes.
 * Two real connectors (trino + clickhouse) seeded so listConnectors resolves
 * their source types.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const tmp = mkdtempSync(join(tmpdir(), 'cross-source-route-test-'));
process.env.DB_PATH = join(tmp, 'csr.db');
process.env.CONNECTOR_SECRET_KEY = randomBytes(32).toString('base64');
delete process.env.AUTH_DISABLED;
process.env.AUTHZ_GRANT_FALLBACK = 'true';

import enforceWriteRoles from '../src/middleware/enforce-write-roles.js';
import onboardingRoutes from '../src/routes/onboarding.js';
import { getDb, closeDb } from '../src/db/sqlite.js';
import { __resetVaultKeyCache } from '../src/services/connector-secret-vault.js';
import { createConnector } from '../src/services/connector-store.js';
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

const body = (over: Record<string, unknown> = {}) => ({
  leftCube: 'active_daily', leftConnector: 'c-trino',
  rightCube: 'af_installs', rightConnector: 'c-ch',
  key: { fromColumn: 'user_id', toColumn: 'customer_user_id' },
  relationship: 'many_to_one', rationale: 'attribution', ...over,
});

beforeEach(() => {
  __resetVaultKeyCache();
  getDb().exec('DELETE FROM cross_source_links; DELETE FROM connector_audit; DELETE FROM connectors;');
  createConnector({ id: 'c-trino', workspaceId: 'local', sourceType: 'trino', label: 'T', config: { host: 'h', catalog: 'game_integration' }, secret: 'x' });
  createConnector({ id: 'c-ch', workspaceId: 'local', sourceType: 'clickhouse', label: 'CH', config: { host: 'h2', catalog: 'events' }, secret: 'y' });
});
afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('POST /api/onboarding/cross-source-links', () => {
  it('declares a link with an advisory (never executable) verdict', async () => {
    const app = await buildTestApp('editor');
    const res = await app.inject({ method: 'POST', url: '/api/onboarding/cross-source-links', payload: body() });
    expect(res.statusCode).toBe(201);
    expect(res.json().link.id).toBeGreaterThan(0);
    expect(res.json().verdict.executable).toBe(false);
    expect(res.json().verdict.rollupJoinEligible).toBe(true); // trino × clickhouse
    await app.close();
  });

  it('400s when both cubes share a connector (use an executable join)', async () => {
    const app = await buildTestApp('editor');
    const res = await app.inject({ method: 'POST', url: '/api/onboarding/cross-source-links', payload: body({ rightConnector: 'c-trino' }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('SAME_SOURCE');
    await app.close();
  });

  it('404s an unknown connector', async () => {
    const app = await buildTestApp('editor');
    const res = await app.inject({ method: 'POST', url: '/api/onboarding/cross-source-links', payload: body({ rightConnector: 'ghost' }) });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('CONNECTOR_NOT_FOUND');
    await app.close();
  });

  it('403s a viewer', async () => {
    const app = await buildTestApp('viewer');
    const res = await app.inject({ method: 'POST', url: '/api/onboarding/cross-source-links', payload: body() });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('GET + DELETE /api/onboarding/cross-source-links', () => {
  it('lists declared links with verdicts and soft-removes one', async () => {
    const app = await buildTestApp('editor');
    const created = await app.inject({ method: 'POST', url: '/api/onboarding/cross-source-links', payload: body() });
    const id = created.json().link.id;

    const list = await app.inject({ method: 'GET', url: '/api/onboarding/cross-source-links' });
    expect(list.statusCode).toBe(200);
    expect(list.json().links).toHaveLength(1);
    expect(list.json().links[0].verdict.executable).toBe(false);

    const del = await app.inject({ method: 'DELETE', url: `/api/onboarding/cross-source-links/${id}` });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/onboarding/cross-source-links' });
    expect(after.json().links).toHaveLength(0);
    await app.close();
  });
});
