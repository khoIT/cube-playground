/**
 * Integration tests for POST /api/onboarding/cross-game-join.
 *
 * Asserts: dual-game grant (target game must also be granted, else 403); the
 * happy path stages the join on the draft; a non-Trino initiating connector is
 * refused (409 CROSS_SOURCE → Phase C); an unknown target cube → 404; viewer is
 * blocked by the write-role gate. Profiler config + existing-model reader mocked.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const tmp = mkdtempSync(join(tmpdir(), 'cross-game-test-'));
process.env.DB_PATH = join(tmp, 'cg.db');
delete process.env.AUTH_DISABLED;
process.env.AUTHZ_GRANT_FALLBACK = 'true';

// Profiler config: getConnector source type varies by id (so we can exercise the
// non-Trino refusal); schemaForGame maps the Trino games.
vi.mock('../src/services/trino-profiler-config.js', () => ({
  WORKED_EXAMPLE_CONNECTOR_ID: 'existing-model',
  isProfilerConfigured: () => true,
  listConnectors: () => [],
  getConnector: (id?: string) => ({ id: id ?? 'game_integration', sourceType: id === 'ch' ? 'clickhouse' : 'trino', label: 'X', workspaceId: 'local', host: 'h', port: 443, user: 'u', password: '', catalog: 'game_integration', ssl: true }),
  schemaForGame: (g: string) => (g === 'ballistar' ? 'ballistar_vn' : g === 'cfm' ? 'cfm_vn' : null),
}));

// Existing model reader: the target game owns a `cfm_active_daily` cube.
vi.mock('../src/services/existing-model-reader.js', () => ({
  readExistingModel: (game: string) => ({
    game,
    configured: true,
    cubes: game === 'cfm' ? [{ name: 'cfm_active_daily', sqlTable: 'game_integration.cfm_vn.active_daily', dimensions: [], measures: [], joins: [] }] : [],
  }),
}));

import enforceWriteRoles from '../src/middleware/enforce-write-roles.js';
import onboardingRoutes from '../src/routes/onboarding.js';
import { getDb, closeDb } from '../src/db/sqlite.js';
import { upsertDraft } from '../src/services/onboarding-draft-store.js';
import { CubeModelSchema } from '../src/types/cube-model.js';
import type { AuthenticatedUser } from '../src/middleware/authenticate.js';

type Role = 'viewer' | 'editor' | 'admin';

function userFor(role: Role, games: string[]): AuthenticatedUser {
  // Grants scoped to 'local' workspace (the workspace this mini test app resolves to).
  return { id: role, username: role, email: `${role}@vng`, role, gamesByWorkspace: { local: games }, workspaces: [], features: {} };
}

// Minimal workspace stub so onboarding's req.workspace.id resolves without the full plugin.
const localWorkspaceStub = { id: 'local' };

async function buildTestApp(role: Role, games: string[]): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest('user', undefined);
  app.decorateRequest('owner', 'tester');
  app.decorateRequest('buildCubeCtxForGame', null);
  app.decorateRequest('workspace', localWorkspaceStub);
  app.addHook('onRequest', async (req) => {
    (req as { user?: AuthenticatedUser }).user = userFor(role, games);
    (req as { buildCubeCtxForGame: unknown }).buildCubeCtxForGame = () => ({ cubeApiUrl: 'http://cube', token: 't' });
  });
  await app.register(enforceWriteRoles);
  await app.register(onboardingRoutes);
  await app.ready();
  return app;
}

function seedDraft(connectorId = 'game_integration'): number {
  const model = CubeModelSchema.parse({
    cubes: [{ name: 'active_daily', sql_table: 'game_integration.ballistar_vn.active_daily', dimensions: [{ name: 'user_id', sql: 'user_id', type: 'string', primary_key: true }], measures: [{ name: 'count', type: 'count' }] }],
  });
  const d = upsertDraft({ game: 'ballistar', connectorId, schemaName: 'ballistar_vn', cubeName: 'active_daily', model, yaml: 'cubes: []', source: 'cold', createdBy: 'editor@vng' });
  return d.id;
}

const body = (draftId: number, over: Record<string, unknown> = {}) => ({
  draftId, targetGame: 'cfm', targetCube: 'cfm_active_daily', fromColumn: 'user_id', toColumn: 'user_id', relationship: 'many_to_one', ...over,
});

beforeEach(() => {
  getDb().exec('DELETE FROM onboarding_draft_audit; DELETE FROM onboarding_draft_models;');
});
afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('POST /api/onboarding/cross-game-join', () => {
  it('stages the join when the user holds both games', async () => {
    const app = await buildTestApp('editor', ['ballistar', 'cfm']);
    const id = seedDraft();
    const res = await app.inject({ method: 'POST', url: '/api/onboarding/cross-game-join', payload: body(id) });
    expect(res.statusCode).toBe(200);
    const joins = res.json().draft.model.cubes[0].joins;
    expect(joins[0].name).toBe('cfm_active_daily');
    expect(joins[0].sql).toBe('{CUBE}.user_id = {cfm_active_daily}.user_id');
    await app.close();
  });

  it('403s when the target game is not granted (dual-grant intersection)', async () => {
    const app = await buildTestApp('editor', ['ballistar']);
    const id = seedDraft();
    const res = await app.inject({ method: 'POST', url: '/api/onboarding/cross-game-join', payload: body(id) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('GAME_FORBIDDEN');
    await app.close();
  });

  it('409s a non-Trino initiating connector (cross-source → Phase C)', async () => {
    const app = await buildTestApp('editor', ['ballistar', 'cfm']);
    const id = seedDraft('ch');
    const res = await app.inject({ method: 'POST', url: '/api/onboarding/cross-game-join', payload: body(id) });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CROSS_SOURCE');
    await app.close();
  });

  it('404s an unknown target cube', async () => {
    const app = await buildTestApp('editor', ['ballistar', 'cfm']);
    const id = seedDraft();
    const res = await app.inject({ method: 'POST', url: '/api/onboarding/cross-game-join', payload: body(id, { targetCube: 'ghost' }) });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('TARGET_CUBE_NOT_FOUND');
    await app.close();
  });

  it('403s a viewer (write-role gate)', async () => {
    const app = await buildTestApp('viewer', ['ballistar', 'cfm']);
    const id = seedDraft();
    const res = await app.inject({ method: 'POST', url: '/api/onboarding/cross-game-join', payload: body(id) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('WRITE_FORBIDDEN');
    await app.close();
  });
});
