/**
 * GET /internal/cost-breakdown?from=<iso>&to=<iso>&limit=<n>
 *
 * Admin cost bridge: org-wide LLM spend broken down by owner / game /
 * workspace / session, so the main server's admin observability surface can
 * render cost tables without opening chat.db. Owner rows key on `owner_id`
 * (= Keycloak sub); the main server enriches sub→email before serving the FE.
 *
 * Defaults: from = epoch (all-time — "total cost of the whole app"), to = now,
 * limit = 100 top sessions by cost (clamped 1..500).
 *
 * Auth: same unconditional `x-internal-secret` gate as /internal/stats —
 * NOT fail-open under AUTH_DISABLED (exposes other users' activity).
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { queryCostBreakdown } from '../db/cost-breakdown-store.js';
import { config } from '../config.js';
import { buildInternalSecretGate, type InternalSecretGateOptions } from '../middleware/internal-secret.js';

interface InternalCostRouteOptions {
  db: Database.Database;
  /** Test-only override for the secret gate. */
  secretGate?: InternalSecretGateOptions;
}

interface InternalCostQuerystring {
  from?: string;
  to?: string;
  limit?: string;
}

const DEFAULT_SESSION_LIMIT = 100;
const MAX_SESSION_LIMIT = 500;

/** Round to 6 decimal places — same precision as /stats cost_usd. */
function roundCost(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000;
}

const internalCostRoutes: FastifyPluginAsync<InternalCostRouteOptions> = async (fastify, opts) => {
  const gate = buildInternalSecretGate(opts.secretGate);

  fastify.get<{ Querystring: InternalCostQuerystring }>(
    '/internal/cost-breakdown',
    { preHandler: gate },
    async (req, reply) => {
      const toMs = req.query.to ? Date.parse(req.query.to) : Date.now();
      const fromMs = req.query.from ? Date.parse(req.query.from) : 0; // all-time by default
      if (isNaN(fromMs) || isNaN(toMs)) {
        return reply.status(400).send({ error: 'Invalid from/to date format (use ISO 8601)' });
      }

      const rawLimit = req.query.limit ? Number(req.query.limit) : DEFAULT_SESSION_LIMIT;
      const sessionLimit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.floor(rawLimit), 1), MAX_SESSION_LIMIT)
        : DEFAULT_SESSION_LIMIT;

      const breakdown = queryCostBreakdown(opts.db, {
        fromMs,
        toMs,
        sessionLimit,
        rates: {
          costPer1kInputUsd: config.costPer1kInputUsd,
          costPer1kOutputUsd: config.costPer1kOutputUsd,
        },
      });

      return reply.send({
        total: { ...breakdown.total, cost_usd: roundCost(breakdown.total.cost_usd) },
        by_owner: breakdown.by_owner.map((r) => ({ ...r, cost_usd: roundCost(r.cost_usd) })),
        by_game: breakdown.by_game.map((r) => ({ ...r, cost_usd: roundCost(r.cost_usd) })),
        by_workspace: breakdown.by_workspace.map((r) => ({ ...r, cost_usd: roundCost(r.cost_usd) })),
        by_auth: breakdown.by_auth.map((r) => ({ ...r, cost_usd: roundCost(r.cost_usd) })),
        sessions: breakdown.sessions.map((r) => ({ ...r, cost_usd: roundCost(r.cost_usd) })),
        session_total: breakdown.session_total,
      });
    },
  );
};

export default internalCostRoutes;
