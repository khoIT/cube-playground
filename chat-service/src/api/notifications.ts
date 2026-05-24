/**
 * Notifications endpoints (phase-05):
 *   GET    /notifications?unread=1&limit=50  — list (unread first)
 *   POST   /notifications/:id/read           — mark a single notification read
 *   GET    /notifications/scheduler          — diagnostic: registered jobs
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import * as monitoringStore from '../db/monitoring-store.js';
import { scheduler } from '../services/scheduler.js';

interface NotificationsRouteOptions {
  db: Database.Database;
}

const notificationsRoutes: FastifyPluginAsync<NotificationsRouteOptions> = async (fastify, opts) => {
  fastify.get<{ Querystring: { unread?: string; limit?: string } }>(
    '/notifications',
    async (req, reply) => {
      const ownerId = req.headers['x-owner-id'];
      if (!ownerId || typeof ownerId !== 'string') {
        return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      }
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '50', 10) || 50, 1), 200);
      const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
      const rows = monitoringStore.listNotifications(opts.db, ownerId, { unreadOnly, limit });
      const items = rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        payload: safeParse(r.payload_json),
        readAt: r.read_at != null ? new Date(r.read_at).toISOString() : null,
        createdAt: new Date(r.created_at).toISOString(),
      }));
      const unread = rows.filter((r) => r.read_at == null).length;
      return reply.send({ items, unread });
    },
  );

  fastify.post<{ Params: { id: string } }>(
    '/notifications/:id/read',
    async (req, reply) => {
      const ownerId = req.headers['x-owner-id'];
      if (!ownerId || typeof ownerId !== 'string') {
        return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      }
      const ok = monitoringStore.markNotificationRead(opts.db, ownerId, req.params.id);
      if (!ok) return reply.status(404).send({ error: 'Not found or already read' });
      return reply.status(204).send();
    },
  );

  fastify.get('/notifications/scheduler', async (_req, reply) => {
    return reply.send({ jobs: scheduler.list() });
  });
};

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default notificationsRoutes;
