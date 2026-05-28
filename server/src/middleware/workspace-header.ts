/**
 * Fastify plugin: resolves `x-cube-workspace` header → req.workspace + req.cubeCtx.
 *
 * SSRF guard: clients send an id only. The server walks the registry to resolve
 * the URL/auth — a raw client URL never reaches `fetch`.
 *
 * Auth mode plumbing happens here too: each request gets a `cubeCtx` (URL + token),
 * built off the workspace + optional `?game=` query. Routes can use either
 * `req.workspace` (config) or `req.cubeCtx` (ready-to-fetch).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { WorkspaceCtx } from '../services/cube-client.js';
import {
  resolveWorkspace,
  getDefaultWorkspace,
  workspaceAllowsRole,
  type WorkspaceDef,
} from '../services/workspaces-config-loader.js';
import { resolveCubeTokenForWorkspace } from '../services/resolve-cube-token.js';

declare module 'fastify' {
  interface FastifyRequest {
    workspace: WorkspaceDef;
    /** Pre-built Cube ctx for the resolved workspace (game-less by default). */
    cubeCtx: WorkspaceCtx;
    /** Build a ctx scoped to a specific game (so the minted JWT carries game claim). */
    buildCubeCtxForGame: (gameId: string) => WorkspaceCtx;
  }
}

const WORKSPACE_HEADER = 'x-cube-workspace';
const GAME_HEADER = 'x-cube-game';

function buildCtx(workspace: WorkspaceDef, gameId: string | null): WorkspaceCtx {
  const { token } = resolveCubeTokenForWorkspace(workspace, gameId);
  return { cubeApiUrl: workspace.cubeApiUrl, token };
}

function readGameId(request: FastifyRequest): string | null {
  const raw = request.headers[GAME_HEADER];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function workspaceHeaderPlugin(app: FastifyInstance): Promise<void> {
  const fallback = getDefaultWorkspace();
  app.decorateRequest('workspace', fallback);
  app.decorateRequest('cubeCtx', { cubeApiUrl: fallback.cubeApiUrl, token: null });
  app.decorateRequest('buildCubeCtxForGame', null);

  app.addHook('onRequest', async (request: FastifyRequest, reply) => {
    const raw = request.headers[WORKSPACE_HEADER];
    const wsId = typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
    const resolved = resolveWorkspace(wsId);
    if (wsId && !resolved) {
      // Unknown id — never make an outbound request with it. 400 here so the
      // route handler doesn't need to defend itself.
      await reply.status(400).send({
        error: {
          code: 'UNKNOWN_WORKSPACE',
          message: `workspace "${wsId}" is not registered`,
        },
      });
      return;
    }
    const workspace = resolved ?? getDefaultWorkspace();

    // RBAC: only enforce when the client EXPLICITLY picked this workspace
    // (sent the header). Without a header we'd 403 callers who just want
    // to list /api/workspaces or hit auth endpoints, because the default
    // workspace (`prod`) is itself role-gated.
    if (wsId && request.user && !workspaceAllowsRole(workspace, request.user.role)) {
      await reply.status(403).send({
        error: {
          code: 'WORKSPACE_FORBIDDEN',
          message: `workspace "${workspace.id}" requires one of [${(workspace.allowedRoles ?? []).join(', ')}]`,
        },
      });
      return;
    }

    request.workspace = workspace;
    // Auto-scope cubeCtx by X-Cube-Game when present so /load + /sql against a
    // minted-auth workspace (local) get a JWT carrying the per-game claim that
    // Cube's repositoryFactory needs to pick the right schema.
    const gameId = readGameId(request);
    request.cubeCtx = buildCtx(workspace, gameId);
    request.buildCubeCtxForGame = (g: string) => buildCtx(workspace, g);
  });
}

export default fp(workspaceHeaderPlugin, { name: 'workspace-header' });
