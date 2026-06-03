/**
 * GET /internal/stats?subs=<csv>&from=<iso>&to=<iso>
 *
 * Admin telemetry bridge: bulk chat usage for a set of owners (Keycloak subs),
 * so the main server's admin hub can aggregate per-user activity across both
 * DBs without ever opening chat.db directly. Keyed on `owner_id` (= sub), which
 * is how chat sessions are stored — the main server resolves email→sub via
 * `user_access.kc_sub` BEFORE calling (chat.db has no email).
 *
 * Auth: a NEW unconditional `x-internal-secret` gate (see internal-secret.ts).
 * NOT fail-open under AUTH_DISABLED — this exposes other users' activity.
 *
 * Distinct from the public `GET /stats` (self-scoped by x-owner-id), which is
 * left untouched.
 *
 * Response: { stats: { [sub]: { turns, input_tokens, output_tokens, cost_usd, by_skill } } }
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { queryStatsBulk } from '../db/chat-store.js';
import { config } from '../config.js';
import { buildInternalSecretGate, type InternalSecretGateOptions } from '../middleware/internal-secret.js';

interface InternalStatsRouteOptions {
  db: Database.Database;
  /** Test-only override for the secret gate. */
  secretGate?: InternalSecretGateOptions;
}

interface InternalStatsQuerystring {
  subs?: string;
  from?: string;
  to?: string;
}

const internalStatsRoutes: FastifyPluginAsync<InternalStatsRouteOptions> = async (fastify, opts) => {
  const gate = buildInternalSecretGate(opts.secretGate);

  fastify.get<{ Querystring: InternalStatsQuerystring }>(
    '/internal/stats',
    { preHandler: gate },
    async (req, reply) => {
      const subs = (req.query.subs ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (subs.length === 0) {
        return reply.status(400).send({ error: 'Missing ?subs= (comma-separated owner subs)' });
      }

      const toMs = req.query.to ? Date.parse(req.query.to) : Date.now();
      const fromMs = req.query.from ? Date.parse(req.query.from) : toMs - 30 * 24 * 60 * 60 * 1000;
      if (isNaN(fromMs) || isNaN(toMs)) {
        return reply.status(400).send({ error: 'Invalid from/to date format (use ISO 8601)' });
      }

      const bulk = queryStatsBulk(opts.db, { ownerIds: subs, fromMs, toMs });

      const stats: Record<string, unknown> = {};
      for (const [sub, s] of Object.entries(bulk)) {
        const costUsd =
          (s.input_tokens / 1000) * config.costPer1kInputUsd +
          (s.output_tokens / 1000) * config.costPer1kOutputUsd;
        stats[sub] = {
          turns: s.turns,
          input_tokens: s.input_tokens,
          output_tokens: s.output_tokens,
          cost_usd: Math.round(costUsd * 1_000_000) / 1_000_000,
          by_skill: s.by_skill,
        };
      }

      return reply.send({ stats });
    },
  );
};

export default internalStatsRoutes;
