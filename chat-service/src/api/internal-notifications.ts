/**
 * POST /internal/notifications
 *
 * Internal bridge endpoint: the main server posts anomaly alerts, rule
 * breaches, and digest payloads here so they land in the chat-service
 * notifications table (owner-scoped, surfaced by NotificationBell).
 *
 * Auth: UNCONDITIONAL x-internal-secret gate — mirrors internal-stats.ts.
 * No AUTH_DISABLED break-glass: an unauthenticated caller must never be
 * able to spam notifications into any owner's inbox.
 *
 * Body: { ownerId: string, kind: string, payload: unknown }
 *
 * The id is generated here (UUID v4 via crypto.randomUUID) so the server
 * never needs to coordinate notification IDs.
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { buildInternalSecretGate, type InternalSecretGateOptions } from '../middleware/internal-secret.js';
import { InAppNotificationDriver } from '../services/in-app-notification-driver.js';

interface InternalNotificationsRouteOptions {
  db: Database.Database;
  /** Test-only override for the secret gate. */
  secretGate?: InternalSecretGateOptions;
}

interface NotifyBody {
  ownerId: string;
  kind: string;
  payload: unknown;
}

const internalNotificationsRoutes: FastifyPluginAsync<InternalNotificationsRouteOptions> = async (
  fastify,
  opts,
) => {
  const gate = buildInternalSecretGate(opts.secretGate);
  const driver = new InAppNotificationDriver(opts.db);

  fastify.post<{ Body: NotifyBody }>(
    '/internal/notifications',
    { preHandler: gate },
    async (req, reply) => {
      const { ownerId, kind, payload } = req.body ?? {};

      if (typeof ownerId !== 'string' || !ownerId.trim()) {
        return reply.status(400).send({ error: 'ownerId is required' });
      }
      if (typeof kind !== 'string' || !kind.trim()) {
        return reply.status(400).send({ error: 'kind is required' });
      }

      const id = crypto.randomUUID();
      await driver.send({ id, ownerId, kind, payload });

      return reply.status(201).send({ id });
    },
  );
};

export default internalNotificationsRoutes;
