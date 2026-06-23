/**
 * Admin access-management API. Lists users and mutates role/status/grants —
 * the surface the admin UI drives. Writes go to the DB access store only (no
 * Keycloak mutation). Every route is gated at router scope by `requireRole`
 * ('admin') + `requireFeature`('admin'); every mutation is audited.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireRole } from '../middleware/require-role.js';
import { requireFeature } from '../middleware/require-feature.js';
import { listUsers, normalizeEmail } from '../auth/access-store.js';
import {
  upsertUserAccess,
  setRole,
  setStatus,
  setWorkspaces,
  setWorkspaceGames,
  setFeatures,
  LastAdminError,
} from '../auth/access-store-mutators.js';
import { recordAccessAudit } from '../auth/access-audit-store.js';
import { FEATURE_KEYS } from '../auth/feature-keys.js';
import {
  listWorkspacesPublic,
  resolveWorkspace,
  type WorkspaceDef,
} from '../services/workspaces-config-loader.js';
import { loadGamesConfig } from '../services/games-config-loader.js';
import { listWorkspaceGameIds } from '../services/prod-game-registry.js';

const roleEnum = z.enum(['viewer', 'editor', 'admin']);
const statusEnum = z.enum(['pending', 'active', 'disabled']);

const createBody = z.object({
  email: z.string().email(),
  role: roleEnum.optional(),
  status: statusEnum.optional(),
  workspaceIds: z.array(z.string()).optional(),
  // Per-workspace game grants: { [workspaceId]: gameIds[] }.
  gamesByWorkspace: z.record(z.string(), z.array(z.string())).optional(),
  features: z.record(z.string(), z.boolean()).optional(),
});
const patchBody = z.object({ role: roleEnum.optional(), status: statusEnum.optional() });
const idsBody = z.object({ workspaceIds: z.array(z.string()) });
const wsGameIdsBody = z.object({ gameIds: z.array(z.string()) });
const featuresBody = z.object({ features: z.record(z.string(), z.boolean()) });

/**
 * Games a workspace can expose: a prefix workspace surfaces every game the cube
 * serves (its `/cubes` registry, ~65 on prod); a game_id workspace surfaces
 * every configured game. Drives the admin matrix so it offers exactly the games
 * a workspace can resolve.
 */
async function availableGamesForWorkspace(
  ws: Pick<WorkspaceDef, 'id' | 'cubeApiUrl' | 'gameModel'>,
): Promise<string[]> {
  return listWorkspaceGameIds(ws);
}

export default async function adminAccessRoutes(app: FastifyInstance): Promise<void> {
  // Router-scope enforcement: admin role AND the admin feature, on every route.
  app.addHook('preHandler', requireRole('admin'));
  app.addHook('preHandler', requireFeature('admin'));

  const actor = (req: { user?: { email?: string } }): string =>
    req.user?.email ? normalizeEmail(req.user.email) : 'unknown';

  app.get('/api/admin/users', async () => ({ users: listUsers() }));

  app.get('/api/admin/registry', async () => {
    const workspaces = listWorkspacesPublic();
    // Per-workspace available games (full def needed for the prefix workspace's
    // /cubes fetch — listWorkspacesPublic strips cubeApiUrl).
    const gamesByWorkspace: Record<string, string[]> = {};
    for (const w of workspaces) {
      const full = resolveWorkspace(w.id);
      gamesByWorkspace[w.id] = full ? await availableGamesForWorkspace(full) : [];
    }
    // Game labels: gds.config names for the games it knows, plus id-only entries
    // for any game a workspace exposes that gds.config doesn't name (prod serves
    // ~65; gds.config names ~8). The matrix falls back to the id for the rest.
    const known = loadGamesConfig().games;
    const knownIds = new Set(known.map((g) => g.id));
    const extra = new Set<string>();
    for (const ids of Object.values(gamesByWorkspace)) {
      for (const id of ids) if (!knownIds.has(id)) extra.add(id);
    }
    return {
      workspaces: workspaces.map((w) => ({ id: w.id, label: w.label })),
      games: [
        ...known.map((g) => ({ id: g.id, name: g.name })),
        // id-only games sorted for a stable, scannable matrix (it has search too).
        ...[...extra].sort().map((id) => ({ id, name: id })),
      ],
      gamesByWorkspace,
      featureKeys: [...FEATURE_KEYS],
    };
  });

  app.post('/api/admin/users', async (req, reply) => {
    const parse = createBody.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'Invalid body' });
    const { email, role, status, workspaceIds, gamesByWorkspace, features } = parse.data;
    const target = normalizeEmail(email);
    // Pre-provisioned users default to active (the invite-before-login path).
    // `role` passes through undefined so an existing user's role is preserved
    // (new users get the SQL default 'viewer'); upsert guards against
    // demoting/disabling the last active admin.
    try {
      upsertUserAccess({ email: target, role, status: status ?? 'active' });
    } catch (err) {
      if (err instanceof LastAdminError) return reply.status(409).send({ error: err.message });
      throw err;
    }
    if (workspaceIds) setWorkspaces(target, workspaceIds);
    if (gamesByWorkspace) {
      for (const [wsId, gameIds] of Object.entries(gamesByWorkspace)) {
        // Skip unregistered workspaces — mirrors the dedicated PUT guard so the
        // create path can't seed junk grant rows for a non-existent workspace.
        if (!resolveWorkspace(wsId)) continue;
        setWorkspaceGames(target, wsId, gameIds);
      }
    }
    if (features) setFeatures(target, features);
    recordAccessAudit({ actorEmail: actor(req), action: 'create_user', targetEmail: target, detail: parse.data });
    return reply.status(201).send({ ok: true, email: target });
  });

  app.patch<{ Params: { email: string } }>('/api/admin/users/:email', async (req, reply) => {
    const parse = patchBody.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'Invalid body' });
    const target = normalizeEmail(req.params.email);
    try {
      if (parse.data.role) setRole(target, parse.data.role);
      if (parse.data.status) setStatus(target, parse.data.status);
    } catch (err) {
      if (err instanceof LastAdminError) return reply.status(409).send({ error: err.message });
      throw err;
    }
    recordAccessAudit({ actorEmail: actor(req), action: 'patch_user', targetEmail: target, detail: parse.data });
    return { ok: true };
  });

  app.put<{ Params: { email: string } }>('/api/admin/users/:email/workspaces', async (req, reply) => {
    const parse = idsBody.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'Invalid body' });
    const target = normalizeEmail(req.params.email);
    setWorkspaces(target, parse.data.workspaceIds);
    recordAccessAudit({ actorEmail: actor(req), action: 'set_workspaces', targetEmail: target, detail: parse.data });
    return { ok: true };
  });

  app.put<{ Params: { email: string; wsId: string } }>(
    '/api/admin/users/:email/workspaces/:wsId/games',
    async (req, reply) => {
      const parse = wsGameIdsBody.safeParse(req.body);
      if (!parse.success) return reply.status(400).send({ error: 'Invalid body' });
      const { wsId } = req.params;
      // Reject grants for a workspace that isn't in the registry (no junk rows).
      if (!resolveWorkspace(wsId)) {
        return reply.status(400).send({ error: `Unknown workspace "${wsId}"` });
      }
      const target = normalizeEmail(req.params.email);
      setWorkspaceGames(target, wsId, parse.data.gameIds);
      recordAccessAudit({
        actorEmail: actor(req),
        action: 'set_workspace_games',
        targetEmail: target,
        detail: { workspaceId: wsId, gameIds: parse.data.gameIds },
      });
      return { ok: true };
    },
  );

  app.put<{ Params: { email: string } }>('/api/admin/users/:email/features', async (req, reply) => {
    const parse = featuresBody.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'Invalid body' });
    const target = normalizeEmail(req.params.email);
    setFeatures(target, parse.data.features);
    recordAccessAudit({ actorEmail: actor(req), action: 'set_features', targetEmail: target, detail: parse.data });
    return { ok: true };
  });
}
