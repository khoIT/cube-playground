/**
 * GET /stats?owner=<id>&from=<iso>&to=<iso>
 *
 * Returns aggregated token usage and cost for a given owner + date range.
 * Owner must match the X-Owner-Id request header (403 on mismatch).
 *
 * Response shape:
 *   { turns, input_tokens, output_tokens, cost_usd, by_skill }
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { queryStats } from '../db/chat-store.js';
import { config } from '../config.js';

interface StatsRouteOptions {
  db: Database.Database;
}

interface StatsQuerystring {
  owner?: string;
  from?: string;
  to?: string;
}

const statsRoutes: FastifyPluginAsync<StatsRouteOptions> = async (fastify, opts) => {
  fastify.get<{ Querystring: StatsQuerystring }>(
    '/stats',
    async (req, reply) => {
      const ownerId = req.headers['x-owner-id'];
      if (!ownerId || typeof ownerId !== 'string') {
        return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      }

      const { owner, from, to } = req.query;

      if (!owner) {
        return reply.status(400).send({ error: 'Missing ?owner= query param' });
      }

      // Enforce that the requesting owner can only query their own stats
      if (owner !== ownerId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      // Parse date range — default to "last 30 days" when omitted
      const toMs = to ? Date.parse(to) : Date.now();
      const fromMs = from ? Date.parse(from) : toMs - 30 * 24 * 60 * 60 * 1000;

      if (isNaN(fromMs) || isNaN(toMs)) {
        return reply.status(400).send({ error: 'Invalid from/to date format (use ISO 8601)' });
      }

      const stats = queryStats(opts.db, { ownerId: owner, fromMs, toMs });

      const costUsd =
        (stats.input_tokens / 1000) * config.costPer1kInputUsd +
        (stats.output_tokens / 1000) * config.costPer1kOutputUsd;

      return reply.send({
        turns: stats.turns,
        input_tokens: stats.input_tokens,
        output_tokens: stats.output_tokens,
        cost_usd: Math.round(costUsd * 1_000_000) / 1_000_000, // 6 decimal places
        by_skill: stats.by_skill,
      });
    },
  );
};

export default statsRoutes;
