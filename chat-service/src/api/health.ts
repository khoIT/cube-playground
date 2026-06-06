/**
 * GET /health — liveness check for the chat-service.
 * Verifies DB is accessible and ANTHROPIC_API_KEY is configured.
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { keyFailoverStatus } from '../core/anthropic-key-failover.js';

interface HealthRouteOptions {
  db: Database.Database;
}

const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (fastify, opts) => {
  fastify.get('/health', async (_req, reply) => {
    let dbOk = false;
    try {
      opts.db.prepare('SELECT 1').get();
      dbOk = true;
    } catch {
      // db unavailable
    }

    const sdkConfigured = Boolean(process.env['ANTHROPIC_API_KEY']);

    // Which gateway key is live + which are cooling down after balance
    // exhaustion. Labels only — never key material.
    let keys: ReturnType<typeof keyFailoverStatus> | undefined;
    try {
      keys = keyFailoverStatus();
    } catch {
      // no keys configured (test envs) — omit the block
    }

    reply.send({
      ok: true,
      db: dbOk,
      sdk: sdkConfigured ? 'configured' : 'missing-key',
      ...(keys ? { keys } : {}),
    });
  });
};

export default healthRoutes;
