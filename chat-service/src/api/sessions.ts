/**
 * Session management endpoints:
 *   GET    /sessions?game=<id>  — list owner+game sessions
 *   GET    /sessions/:id        — full session with turns
 *   PATCH  /sessions/:id        — rename session title
 *   DELETE /sessions/:id        — hard-delete + tombstone, refreshes snapshot
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import * as chatStore from '../db/chat-store.js';
import { writeChatSnapshot } from '../db/snapshot-store.js';
import type { ChatTurnRow, QueryArtifact, ChartArtifact } from '../types.js';

// ---------------------------------------------------------------------------
// Row → FE-DTO transform
//
// The chat_turns table stores raw columns (user_text, assistant_text, _json
// blobs, started_at as epoch ms). The FE consumer (useChatSession +
// chat-thread-page.sessionTurnsToMessages) expects a flatter shape:
//   { id, role, text, createdAt, toolCalls, artifacts, charts }
// This mapper produces that shape so historical sessions hydrate correctly.
// ---------------------------------------------------------------------------

interface TurnDto {
  id: string;
  role: 'user' | 'assistant' | 'system_preamble';
  text: string;
  createdAt: string;
  toolCalls: Array<{ id: string; name: string; ok: boolean; ms: number; summary: string }>;
  artifacts: QueryArtifact[];
  charts: ChartArtifact[];
}

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToTurn(row: ChatTurnRow): TurnDto {
  const text = row.role === 'user' ? row.user_text ?? '' : row.assistant_text ?? '';
  return {
    id: row.id,
    role: row.role,
    text,
    createdAt: new Date(row.started_at).toISOString(),
    toolCalls: safeParseJson(row.tool_calls_json, []),
    artifacts: safeParseJson(row.artifacts_json, []),
    charts: safeParseJson(row.charts_json, []),
  };
}

const PatchBodySchema = z.object({
  title: z.string().min(1).max(64),
});

interface SessionsRouteOptions {
  db: Database.Database;
}

const sessionsRoutes: FastifyPluginAsync<SessionsRouteOptions> = async (fastify, opts) => {
  // GET /sessions?game=<id>&q=<title-substring>
  fastify.get<{ Querystring: { game?: string; q?: string } }>(
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

      const sessions = chatStore.listSessions(opts.db, {
        ownerId,
        gameId,
        limit: 50,
        q: req.query.q,
      });
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

      const turns = chatStore.listTurns(opts.db, session.id).map(rowToTurn);
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

  // DELETE /sessions/:id — hard-delete + tombstone, then refresh the committed
  // snapshot so other dev machines reconcile on their next hydrate.
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

      chatStore.deleteSession(opts.db, req.params.id);

      // Snapshot write failures (e.g. read-only checkout) should not fail the
      // delete — the DB state is already correct; the snapshot is dev-only sync.
      try {
        writeChatSnapshot(opts.db);
      } catch (err) {
        fastify.log.warn(
          { err, sessionId: req.params.id },
          '[chat-snapshot] post-delete snapshot write failed',
        );
      }

      return reply.status(204).send();
    },
  );
};

export default sessionsRoutes;
