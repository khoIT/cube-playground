/**
 * Regression test for grant-aware workspace listing.
 *
 * The bug: GET /api/workspaces filtered by ROLE only, never consulting the
 * user's workspace grants — so the switcher showed every role-allowed
 * workspace regardless of what an admin had granted. The fix routes the filter
 * through `userCanAccessWorkspace`: a user with explicit grants sees only those;
 * a user with none falls back to the role gate.
 *
 * A tiny stand-in middleware decorates `request.user` from headers (role +
 * granted workspaces) so we can assert what the route returns per identity,
 * without booting Keycloak or the access store.
 *
 * Config under test (workspaces.config.json): `local` (all roles) and `prod`
 * (allowedRoles: editor, admin).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { LightMyRequestResponse } from 'fastify';

import workspacesRoutes from '../src/routes/workspaces.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify({ logger: false });
  // Stand-in for the auth plugin: build req.user from headers.
  //   x-test-role        → role (default: viewer)
  //   x-test-workspaces  → comma-separated granted workspace ids ('' = none)
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const role = (req.headers['x-test-role'] as string) || 'viewer';
    const wsRaw = req.headers['x-test-workspaces'];
    const workspaces =
      typeof wsRaw === 'string' && wsRaw.length > 0 ? wsRaw.split(',') : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).user = { id: 'u', username: 'u', role, allowedGames: [], workspaces, features: {} };
  });
  await app.register(workspacesRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

function ids(res: LightMyRequestResponse): string[] {
  return (res.json().workspaces as Array<{ id: string }>).map((w) => w.id).sort();
}

describe('GET /api/workspaces — grant-aware filter', () => {
  it('an explicit workspace grant restricts the list to granted ids', async () => {
    // Admin, but granted only `local` → must NOT see `prod` despite the role.
    const res = await app.inject({
      method: 'GET',
      url: '/api/workspaces',
      headers: { 'x-test-role': 'admin', 'x-test-workspaces': 'local' },
    });
    expect(res.statusCode).toBe(200);
    expect(ids(res)).toEqual(['local']);
  });

  it('no grants falls back to the role gate (viewer sees only role-allowed)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/workspaces',
      headers: { 'x-test-role': 'viewer', 'x-test-workspaces': '' },
    });
    expect(res.statusCode).toBe(200);
    // `prod` requires editor/admin → viewer only sees `local`.
    expect(ids(res)).toEqual(['local']);
  });

  it('no grants + admin role falls back to all role-allowed workspaces', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/workspaces',
      headers: { 'x-test-role': 'admin', 'x-test-workspaces': '' },
    });
    expect(res.statusCode).toBe(200);
    expect(ids(res)).toEqual(['local', 'prod']);
  });
});
