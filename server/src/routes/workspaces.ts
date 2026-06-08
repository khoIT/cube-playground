/**
 * Workspaces registry endpoint.
 *
 *   GET /api/workspaces
 *     200 { workspaces: Array<{ id, label, gameModel, authMode, gamePrefixMap?, isDefault }> }
 *
 * Secret-free projection: cubeApiUrl is NEVER returned (SSRF + leakage guard).
 * Clients use this to render the workspace switcher; switching just sets a
 * header on subsequent requests.
 */

import type { FastifyInstance } from 'fastify';

import { listWorkspacesPublic } from '../services/workspaces-config-loader.js';
import {
  computeWorkspaceReadiness,
  computeGamesReadiness,
} from '../services/workspace-readiness.js';
import { computeMember360Coverage } from '../services/member360-coverage.js';
import { userCanAccessWorkspace } from '../auth/authz-decisions.js';
import { getDb } from '../db/sqlite.js';

export default async function workspacesRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/workspaces', async (req) => {
    const all = listWorkspacesPublic();
    // Anonymous callers (no req.user — e.g. early bootstrap before login) see
    // all workspaces so the FE can render the picker for disabled-mode dev.
    // Real-auth mode never lacks req.user here.
    if (!req.user) return { workspaces: all };
    // Grant-aware filter: a user with explicit workspace grants only sees those;
    // a user with none falls back to the role gate (when AUTHZ_GRANT_FALLBACK is
    // on). This is the only place the picker is populated, so filtering here is
    // what actually limits visible workspaces — the request-time header check is
    // a backstop, not the gate.
    const user = req.user;
    const visible = all.filter((w) => userCanAccessWorkspace(user, w));
    return { workspaces: visible };
  });

  // GET /api/workspaces/:id/games-readiness
  //   200 { games: Array<{ id, label, status: 'ok'|'missing'|'error', cubeCount }> }
  //   400 unknown workspace id
  //   500 unexpected
  // Lightweight slice of the readiness report — drives the game picker so games
  // that don't resolve in the active workspace (e.g. prod-only on local) hide.
  app.get<{ Params: { id: string } }>(
    '/api/workspaces/:id/games-readiness',
    async (req, reply) => {
      try {
        const games = await computeGamesReadiness(req.params.id);
        return reply.send({ games });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith('unknown workspace')) {
          return reply.status(400).send({ error: msg });
        }
        req.log.error({ err }, '[workspaces] games-readiness failed');
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // GET /api/workspaces/:id/readiness
  //   200 { workspace, games[], coverage, artifacts }
  //   400 unknown workspace id
  //   500 unexpected
  // owner comes from the standard X-Owner-Id header (per Phase 4 contract).
  app.get<{ Params: { id: string } }>(
    '/api/workspaces/:id/readiness',
    async (req, reply) => {
      try {
        const report = await computeWorkspaceReadiness(
          getDb(),
          req.params.id,
          req.owner,
        );
        return reply.send(report);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith('unknown workspace')) {
          return reply.status(400).send({ error: msg });
        }
        req.log.error({ err }, '[workspaces] readiness failed');
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // GET /api/workspaces/:id/member360-coverage
  //   200 { workspace, prefixUnsupported, generatedAt, games[] }
  //   400 unknown workspace id
  //   500 unexpected
  // Per-game Member 360 coverage: /meta diff + 1-row probe across the
  // Trino → Cube YAML → product-config chain. Drives the admin coverage matrix
  // and the end-user "dashboard unavailable" states.
  app.get<{ Params: { id: string } }>(
    '/api/workspaces/:id/member360-coverage',
    async (req, reply) => {
      try {
        const report = await computeMember360Coverage(req.params.id);
        return reply.send(report);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith('unknown workspace')) {
          return reply.status(400).send({ error: msg });
        }
        req.log.error({ err }, '[workspaces] member360-coverage failed');
        return reply.status(500).send({ error: msg });
      }
    },
  );
}
