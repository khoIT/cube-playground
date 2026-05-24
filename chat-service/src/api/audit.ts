/**
 * Audit ingest endpoint — accepts client-side UI events (starter_clicked,
 * field_chip_clicked, followup_clicked, ...) and appends to chat_audit.
 *
 * Append-only. Fire-and-forget from the FE — failures must not break UI.
 *
 *   POST /audit
 *     headers: X-Owner-Id required
 *     body:    { kind, sessionId?, turnId?, detail? }
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import * as chatStore from '../db/chat-store.js';

const BodySchema = z.object({
  kind: z.string().min(1).max(64),
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
  detail: z.unknown().optional(),
});

interface AuditRouteOptions {
  db: Database.Database;
}

const auditRoutes: FastifyPluginAsync<AuditRouteOptions> = async (fastify, opts) => {
  fastify.post('/audit', async (req, reply) => {
    const ownerId = req.headers['x-owner-id'];
    if (!ownerId || typeof ownerId !== 'string') {
      return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
    }
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const { kind, sessionId, turnId, detail } = parsed.data;
    chatStore.insertAudit(opts.db, {
      sessionId,
      turnId,
      kind,
      detail: { ...((detail as object | undefined) ?? {}), owner_id: ownerId },
    });
    return reply.status(204).send();
  });

  // GET /audit/intents — recent intent_routed events for the calling owner.
  // Used by the starter library to rank starter cards by topic histogram.
  fastify.get<{ Querystring: { limit?: string } }>(
    '/audit/intents',
    async (req, reply) => {
      const ownerId = req.headers['x-owner-id'];
      if (!ownerId || typeof ownerId !== 'string') {
        return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      }
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '20', 10) || 20, 1), 100);
      const intents = chatStore.listRecentIntents(opts.db, ownerId, limit);
      return reply.send({ intents });
    },
  );
};

export default auditRoutes;
