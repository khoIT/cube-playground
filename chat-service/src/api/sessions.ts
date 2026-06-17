/**
 * Session management endpoints:
 *   GET    /sessions?game=<id>  — list owner+game sessions (hides deleted)
 *   GET    /sessions/:id        — full session with turns (404 if deleted)
 *   PATCH  /sessions/:id        — rename session title
 *   DELETE /sessions/:id        — soft-delete (sets deleted_at, no cascade)
 *   POST   /sessions/:id/restore — clear deleted_at (owner-scoped)
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import * as chatStore from '../db/chat-store.js';
import { canAccessOwnedResource } from './debug-shared.js';
import { writeChatSnapshot } from '../db/snapshot-store.js';
import { getStreamRegistry } from '../core/stream-registry-instance.js';
import type { ChatTurnRow, QueryArtifact, ChartArtifact, DisambigOptionsData } from '../types.js';

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
  /** Concatenated assistant chain-of-thought captured from `thinking` SSE
   *  events on the live turn; null on older turns and on user/system rows. */
  reasoning?: string | null;
  /** True when this turn was served from the response cache. */
  cacheHit?: boolean;
  /** Freshness of cached payload — set only when cacheHit=true. */
  cacheFreshness?: 'refreshed' | 'stale' | null;
  /** Turn id of the original cached turn this replayed from (provenance). */
  originalTurnId?: string | null;
  /** Choice-chip set this turn offered, re-rendered on reload. Null when none. */
  disambig?: DisambigOptionsData | null;
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
  const cacheHit = (row.cache_hit ?? 0) === 1;
  return {
    id: row.id,
    role: row.role,
    text,
    createdAt: new Date(row.started_at).toISOString(),
    toolCalls: safeParseJson(row.tool_calls_json, []),
    artifacts: safeParseJson(row.artifacts_json, []),
    charts: safeParseJson(row.charts_json, []),
    // reasoning_json is stored as the raw concatenated thinking text (no JSON
    // wrapping). Null on user/system rows and on turns persisted before
    // reasoning capture was wired up.
    reasoning: row.role === 'assistant' ? row.reasoning_json ?? null : null,
    cacheHit,
    cacheFreshness: cacheHit ? row.cache_freshness ?? null : null,
    originalTurnId: cacheHit ? row.original_turn_id ?? null : null,
    disambig:
      row.role === 'assistant'
        ? safeParseJson<DisambigOptionsData | null>(row.disambig_json ?? null, null)
        : null,
  };
}

const PatchBodySchema = z.object({
  title: z.string().min(1).max(64),
});

/** Resolve the active Cube workspace from the request, defaulting to 'local'. */
function readWorkspace(req: { headers: Record<string, string | string[] | undefined> }): string {
  const raw = req.headers['x-cube-workspace'];
  if (Array.isArray(raw)) return (raw[0] ?? 'local').toString();
  return typeof raw === 'string' && raw.trim() ? raw.trim() : 'local';
}

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

      // Partition sessions by cube workspace so switching between local/prod
      // doesn't surface threads whose cube refs target a different namespace.
      // Legacy clients (or fixture seeds) without the header land on 'local'.
      const workspace = readWorkspace(req);

      const sessions = chatStore.listSessions(opts.db, {
        ownerId,
        gameId,
        workspace,
        limit: 50,
        q: req.query.q,
      });
      return reply.send(sessions);
    },
  );

  // GET /sessions/shared?game=<id>&q=<title-substring>
  // Cross-owner "shared with team" listing. Static path — registered before
  // the parametric '/sessions/:id' so it is never swallowed by :id.
  fastify.get<{ Querystring: { game?: string; q?: string } }>(
    '/sessions/shared',
    async (req, reply) => {
      const ownerId = req.headers['x-owner-id'];
      if (!ownerId || typeof ownerId !== 'string') {
        return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      }
      const gameId = req.query.game;
      if (!gameId) {
        return reply.status(400).send({ error: 'Missing ?game= query param' });
      }
      const workspace = readWorkspace(req);
      const sessions = chatStore.listSharedSessions(opts.db, {
        gameId,
        workspace,
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
      // Treat soft-deleted sessions as not found for the chat UI path.
      if (!session || session.deleted_at != null) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      // Owner sees their own session; any authenticated member may READ a
      // session the owner has published ('shared'). Private + non-owner → 403.
      const isOwner = session.owner_id === ownerId;
      if (!isOwner && session.visibility !== 'shared') {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const turns = chatStore.listTurns(opts.db, session.id).map(rowToTurn);
      // Surface the active turnId so a refreshed client knows to attach to
      // the live SSE replay endpoint instead of opening a fresh turn.
      // findRunning() resolves through the compact-alias map, so requesting
      // the pre-compact sessionId still locates the live turn.
      const activeTurnId = getStreamRegistry().findRunning(session.id)?.turnId ?? null;
      // readOnly tells the FE to lock the composer + hide owner-only controls
      // when a non-owner is viewing a shared session.
      return reply.send({ session, turns, activeTurnId, readOnly: !isOwner });
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

  // DELETE /sessions/:id — soft-delete: sets deleted_at, does NOT cascade.
  // Session disappears from chat UI immediately; still visible in /dev/chat-audit.
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

      chatStore.softDeleteSession(opts.db, req.params.id);

      // Mirror soft-delete state to the committed snapshot so other dev machines
      // see deleted_at when they hydrate. Best-effort — snapshot path may be
      // read-only in CI.
      try {
        writeChatSnapshot(opts.db);
      } catch (err) {
        fastify.log.warn(
          { err, sessionId: req.params.id },
          '[chat-snapshot] post-soft-delete snapshot write failed',
        );
      }

      return reply.status(204).send();
    },
  );

  // POST /sessions/:id/restore — clear deleted_at (owner-scoped).
  fastify.post<{ Params: { id: string } }>(
    '/sessions/:id/restore',
    async (req, reply) => {
      const ownerId = req.headers['x-owner-id'];
      if (!ownerId || typeof ownerId !== 'string') {
        return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      }

      const session = chatStore.getSession(opts.db, req.params.id);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      if (!canAccessOwnedResource(session.owner_id, ownerId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      chatStore.restoreSession(opts.db, req.params.id);

      const restored = chatStore.getSession(opts.db, req.params.id);
      return reply.status(200).send(restored);
    },
  );

  // POST /sessions/:id/share and /sessions/:id/unshare — owner-only.
  // Publish/unpublish a session to the team. Only the owner may toggle it;
  // a non-owner attempt is 403 (mirrors rename/delete).
  const toggleVisibility =
    (visibility: 'private' | 'shared') =>
    async (req: { headers: Record<string, string | string[] | undefined>; params: { id: string } }, reply: import('fastify').FastifyReply) => {
      const ownerId = req.headers['x-owner-id'];
      if (!ownerId || typeof ownerId !== 'string') {
        return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      }
      const session = chatStore.getSession(opts.db, req.params.id);
      if (!session || session.deleted_at != null) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      if (session.owner_id !== ownerId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      chatStore.setSessionVisibility(opts.db, session.id, visibility);
      return reply.send(chatStore.getSession(opts.db, session.id));
    };

  fastify.post<{ Params: { id: string } }>('/sessions/:id/share', toggleVisibility('shared'));
  fastify.post<{ Params: { id: string } }>('/sessions/:id/unshare', toggleVisibility('private'));
};

export default sessionsRoutes;
