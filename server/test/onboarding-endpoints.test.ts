/**
 * Integration tests for the onboarding HTTP surface.
 *
 * Mocks the Trino profiler (no live warehouse) and the cube-model writer (no
 * live Cube). Asserts: generate → accept → approve happy path; viewer 403 on
 * mutations (enforce-write-roles); game-grant 403; self-approve allowed in dev.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const tmp = mkdtempSync(join(tmpdir(), 'onboarding-ep-test-'));
process.env.DB_PATH = join(tmp, 'ep.db');
delete process.env.AUTH_DISABLED; // exercise the real write-role gate
process.env.AUTHZ_GRANT_FALLBACK = 'true';

// ── Mock the warehouse profiler — no live Trino ─────────────────────────────
vi.mock('../src/services/trino-profiler-config.js', () => ({
  getConnector: () => ({ id: 'game_integration', label: 'GI', workspaceId: 'local', host: 'h', port: 443, user: 'u', password: '', catalog: 'game_integration', ssl: true }),
  schemaForGame: (g: string) => (g === 'ballistar' ? 'ballistar_vn' : null),
  isProfilerConfigured: () => true,
  listConnectors: () => [{ id: 'game_integration', label: 'GI', workspaceId: 'local', catalog: 'game_integration', host: 'h', configured: true }],
}));

vi.mock('../src/services/trino-profiler.js', () => ({
  listTables: async () => [{ schema: 'ballistar_vn', table: 'active_daily', columns: [] }],
  profileTable: async (_c: unknown, schema: string, table: string) => ({
    schema,
    table,
    rowCount: 100_000,
    columns: [
      { name: 'user_id', dataType: 'varchar', nullPct: 0, approxDistinct: 99_000, rowCount: 100_000, isUnique: true, min: null, max: null, sampleValues: [] },
      { name: 'log_date', dataType: 'date', nullPct: 0, approxDistinct: 365, rowCount: 100_000, isUnique: false, min: null, max: null, sampleValues: [] },
      { name: 'total_online_time', dataType: 'bigint', nullPct: 0, approxDistinct: 80_000, rowCount: 100_000, isUnique: false, min: null, max: null, sampleValues: [] },
    ],
  }),
}));

// ── Mock the writer — no live Cube /meta ────────────────────────────────────
const writeCubeModelMock = vi.fn(async () => ({ path: '/fake/active_daily.yml', metaAcknowledged: true }));
vi.mock('../src/services/cube-model-writer.js', () => ({
  writeCubeModel: (...args: unknown[]) => writeCubeModelMock(...(args as [])),
  CubeModelWriteError: class extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  },
}));

import enforceWriteRoles from '../src/middleware/enforce-write-roles.js';
import onboardingRoutes from '../src/routes/onboarding.js';
import { getDb, closeDb } from '../src/db/sqlite.js';
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

beforeEach(() => {
  getDb().exec('DELETE FROM onboarding_draft_audit; DELETE FROM onboarding_draft_models;');
  writeCubeModelMock.mockClear();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('happy path: generate → accept → approve', () => {
  it('generates a draft, accepts it, then approves + writes', async () => {
    const app = await buildTestApp('editor');

    const gen = await app.inject({
      method: 'POST',
      url: '/api/onboarding/generate',
      payload: { game: 'ballistar', tables: ['active_daily'], mode: 'cold' },
    });
    expect(gen.statusCode).toBe(200);
    const draft = gen.json().drafts[0];
    expect(draft.cubeName).toBe('active_daily');
    expect(draft.status).toBe('pending');

    const acc = await app.inject({ method: 'POST', url: `/api/onboarding/drafts/${draft.id}/accept`, payload: {} });
    expect(acc.statusCode).toBe(200);
    expect(acc.json().draft.status).toBe('accepted');

    const appr = await app.inject({ method: 'POST', url: `/api/onboarding/drafts/${draft.id}/approve`, payload: {} });
    expect(appr.statusCode).toBe(200);
    expect(appr.json().draft.status).toBe('written');
    expect(writeCubeModelMock).toHaveBeenCalledOnce();

    await app.close();
  });
});

describe('RBAC — viewer is denied mutations', () => {
  it('403s a viewer on generate', async () => {
    const app = await buildTestApp('viewer');
    const res = await app.inject({
      method: 'POST',
      url: '/api/onboarding/generate',
      payload: { game: 'ballistar', tables: ['active_daily'], mode: 'cold' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('WRITE_FORBIDDEN');
    await app.close();
  });

  it('lets a viewer read the drafts list (GET)', async () => {
    const app = await buildTestApp('viewer');
    const res = await app.inject({ method: 'GET', url: '/api/onboarding/drafts?game=ballistar' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().drafts)).toBe(true);
    await app.close();
  });
});

describe('game-grant gate', () => {
  it('403s when the user lacks the requested game', async () => {
    const app = await buildTestApp('editor');
    const res = await app.inject({
      method: 'POST',
      url: '/api/onboarding/generate',
      payload: { game: 'cfm', tables: ['active_daily'], mode: 'cold' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('GAME_FORBIDDEN');
    await app.close();
  });
});

describe('approve requires an accepted draft (staging gate)', () => {
  it('409s when approving a still-pending draft', async () => {
    const app = await buildTestApp('editor');
    const gen = await app.inject({
      method: 'POST',
      url: '/api/onboarding/generate',
      payload: { game: 'ballistar', tables: ['active_daily'], mode: 'cold' },
    });
    const draft = gen.json().drafts[0];
    const appr = await app.inject({ method: 'POST', url: `/api/onboarding/drafts/${draft.id}/approve`, payload: {} });
    expect(appr.statusCode).toBe(409);
    expect(appr.json().error.code).toBe('INVALID_STATE');
    expect(writeCubeModelMock).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('accept/reject re-check the game grant (no cross-game bypass)', () => {
  it('403s accept on a draft whose game the user lacks', async () => {
    // Seed a draft for game 'ballistar' as an editor who has it.
    const owner = await buildTestApp('editor');
    const gen = await owner.inject({
      method: 'POST',
      url: '/api/onboarding/generate',
      payload: { game: 'ballistar', tables: ['active_daily'], mode: 'cold' },
    });
    const draftId = gen.json().drafts[0].id;
    await owner.close();

    // A different editor whose allowedGames do NOT include 'ballistar'.
    const app = Fastify();
    app.decorateRequest('user', undefined);
    app.decorateRequest('owner', 'intruder');
    app.decorateRequest('buildCubeCtxForGame', null);
    app.addHook('onRequest', async (req) => {
      (req as { user?: AuthenticatedUser }).user = { id: 'x', username: 'x', email: 'x@vng', role: 'editor', allowedGames: ['cfm'], workspaces: [], features: {} };
    });
    await app.register(enforceWriteRoles);
    await app.register(onboardingRoutes);
    await app.ready();

    const res = await app.inject({ method: 'POST', url: `/api/onboarding/drafts/${draftId}/accept`, payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('GAME_FORBIDDEN');
    await app.close();
  });
});

describe('connectors + introspect', () => {
  it('lists configured connectors', async () => {
    const app = await buildTestApp('editor');
    const res = await app.inject({ method: 'GET', url: '/api/onboarding/connectors' });
    expect(res.statusCode).toBe(200);
    expect(res.json().configured).toBe(true);
    await app.close();
  });

  it('introspects a game schema', async () => {
    const app = await buildTestApp('editor');
    const res = await app.inject({ method: 'GET', url: '/api/onboarding/introspect?game=ballistar' });
    expect(res.statusCode).toBe(200);
    expect(res.json().schema).toBe('ballistar_vn');
    expect(res.json().tables).toHaveLength(1);
    await app.close();
  });
});
