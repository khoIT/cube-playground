/**
 * Session management endpoints:
 *   GET    /sessions?game=<id>  — list owner+game sessions
 *   GET    /sessions/:id        — full session with turns
 *   PATCH  /sessions/:id        — rename session title
 *   DELETE /sessions/:id        — soft-archive
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import * as chatStore from '../db/chat-store.js';

const PatchBodySchema = z.object({
  title: z.string().min(1).max(64),
});

interface SessionsRouteOptions {
  db: Database.Database;
}

const sessionsRoutes: FastifyPluginAsync<SessionsRouteOptions> = async (fastify, opts) => {
  // GET /sessions?game=<id>
  fastify.get<{ Querystring: { game?: string } }>(
    '/sessions',
    async (req, reply) => {
      const ownerId = req.headers['x-owner-id'];
      if (!ownerId || typeof ownerId !== 'string') {
        return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      }

      const gameId = req.query.game;
      if (!gameId) {
        return reply.status(400).send({ error: 'Missing ?game= query param' });
      }

      const sessions = chatStore.listSessions(opts.db, { ownerId, gameId, limit: 50 });
      return reply.send(sessions);
    },
  );

  // GET /sessions/:id
  fastify.get<{ Params: { id: string } }>(
    '/sessions/:id',
    async (req, reply) => {
      const ownerId = req.headers['x-owner-id'];
      if (!ownerId || typeof ownerId !== 'string') {
        return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      }

      const session = chatStore.getSession(opts.db, req.params.id);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      if (session.owner_id !== ownerId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const turns = chatStore.listTurns(opts.db, session.id);
      return reply.send({ session, turns });
    },
  );

  // PATCH /sessions/:id — rename title
  fastify.patch<{ Params: { id: string } }>(
    '/sessions/:id',
    async (req, reply) => {
      const ownerId = req.headers['x-owner-id'];
      if (!ownerId || typeof ownerId !== 'string') {
        return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      }

      const parseResult = PatchBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: 'Invalid body', details: parseResult.error.flatten() });
      }

      const session = chatStore.getSession(opts.db, req.params.id);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      if (session.owner_id !== ownerId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      chatStore.updateSessionTitle(opts.db, session.id, parseResult.data.title);
      const updated = chatStore.getSession(opts.db, session.id);
      return reply.send(updated);
    },
  );

  // DELETE /sessions/:id
  fastify.delete<{ Params: { id: string } }>(
    '/sessions/:id',
    async (req, reply) => {
      const ownerId = req.headers['x-owner-id'];
      if (!ownerId || typeof ownerId !== 'string') {
        return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      }

      const session = chatStore.getSession(opts.db, req.params.id);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      if (session.owner_id !== ownerId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      chatStore.archiveSession(opts.db, req.params.id);
      return reply.status(204).send();
    },
  );
};

export default sessionsRoutes;
