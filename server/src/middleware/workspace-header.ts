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
  type WorkspaceDef,
} from '../services/workspaces-config-loader.js';
import { resolveCubeTokenForWorkspace } from '../services/resolve-cube-token.js';
import {
  userCanAccessWorkspace,
  userCanAccessGame,
} from '../auth/authz-decisions.js';
import type { AuthenticatedUser } from './authenticate.js';

declare module 'fastify' {
  interface FastifyRequest {
    workspace: WorkspaceDef;
    /** Pre-built Cube ctx for the resolved workspace (game-less by default). */
    cubeCtx: WorkspaceCtx;
    /** Build a ctx scoped to a specific game (so the minted JWT carries game claim). */
    buildCubeCtxForGame: (gameId: string) => WorkspaceCtx;
    /**
     * Build a ctx for SCHEMA INTROSPECTION (/meta) under the service principal —
     * never the per-user email. Cube metadata is not user-scoped data, so gating
     * it on the user's per-game cube grant adds no security, only a failure mode
     * (a principal the cube can't resolve → empty /meta → broken identity map →
     * missing row-selection column). Per-user enforcement stays on the DATA path
     * (`cubeCtx` / `buildCubeCtxForGame`, used by cube-proxy `/load`).
     */
    buildIntrospectionCtxForGame: (gameId: string | null) => WorkspaceCtx;
  }
}

const WORKSPACE_HEADER = 'x-cube-workspace';
const GAME_HEADER = 'x-cube-game';

function buildCtx(
  workspace: WorkspaceDef,
  gameId: string | null,
  userId: string | null,
): WorkspaceCtx {
  // Mint the Cube token under the REAL user (email) when known so cube-dev's
  // checkAuth enforces per-user game access too — closing the minted-path gap.
  // Falls back to the service principal ('playground') for dev / unauthenticated.
  const { token } = resolveCubeTokenForWorkspace(workspace, gameId, userId ?? undefined);
  return { cubeApiUrl: workspace.cubeApiUrl, token };
}

// Service-principal ctx for /meta introspection. Mints WITHOUT a user id, so
// `resolveCubeTokenForWorkspace` falls back to the playground principal — a
// principal cube-dev's checkAuth always resolves. Used for reading schema
// shape (identity suggester), never for executing a user's data query.
function buildIntrospectionCtx(workspace: WorkspaceDef, gameId: string | null): WorkspaceCtx {
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
  app.decorateRequest('buildIntrospectionCtxForGame', null);

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
    const user = request.user as AuthenticatedUser | undefined;
    if (wsId && user && !userCanAccessWorkspace(user, workspace)) {
      await reply.status(403).send({
        error: {
          code: 'WORKSPACE_FORBIDDEN',
          message: `workspace "${workspace.id}" is not granted to this user`,
        },
      });
      return;
    }

    request.workspace = workspace;

    // Server-side game enforcement (closes the FE-only gap): when a game is
    // explicitly requested by an authenticated user, it must be in their grants.
    // Fail closed (403) before any token is minted or request proxied.
    const gameId = readGameId(request);
    if (gameId && user && !userCanAccessGame(user, gameId)) {
      await reply.status(403).send({
        error: {
          code: 'GAME_FORBIDDEN',
          message: `game "${gameId}" is not granted to this user`,
        },
      });
      return;
    }

    // Mint the Cube token under the user's stable key (email) when present so
    // cube-dev double-enforces. Auto-scope by X-Cube-Game so repositoryFactory
    // picks the right schema.
    const userId = user?.email ?? null;
    request.cubeCtx = buildCtx(workspace, gameId, userId);
    request.buildCubeCtxForGame = (g: string) => buildCtx(workspace, g, userId);
    request.buildIntrospectionCtxForGame = (g: string | null) => buildIntrospectionCtx(workspace, g);
  });
}

export default fp(workspaceHeaderPlugin, { name: 'workspace-header' });
