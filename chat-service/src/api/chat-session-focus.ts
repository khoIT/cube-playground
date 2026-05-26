/**
 * Phase 03 — session-focus inspection + reset API.
 *
 *   GET    /api/chat/sessions/:id/focus      → current focus bag (+ flags)
 *   DELETE /api/chat/sessions/:id/focus      → atomically clear focus +
 *                                              SDK resume id +
 *                                              disambig memory slots
 *
 * The chat-header chip and Settings → Chat memory panel read from GET; the
 * "Forget all" button and `/forget` slash command call DELETE. The delete is
 * wrapped in a SQLite transaction so the three writes (focus row eviction,
 * SDK conversation id null, disambig resolution row eviction) either all land
 * or none do — clearing two-thirds of memory state would surface as a partial
 * "forget" the user couldn't trust.
 *
 * Auth: X-Owner-Id header must match the session's owner. No cube token is
 * required since this route never touches the Cube API.
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import * as chatStore from '../db/chat-store.js';
import {
  clearFocus,
  getFocus,
  type SessionFocus,
} from '../cache/session-focus-adapter.js';
import { kvEvict } from '../cache/kv-cache-store.js';
import { getStreamRegistry } from '../core/stream-registry-instance.js';
import { writeSseEvent } from '../core/sse-stream.js';
import type { SseEvent } from '../types.js';

interface ChatSessionFocusRouteOptions {
  db: Database.Database;
}

function readOwner(req: { headers: Record<string, unknown> }): string | null {
  const v = req.headers['x-owner-id'];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Broadcast an SSE event to whatever stream is currently listening for this
 * session (if any). Returns silently when no listeners are attached — the
 * registry is best-effort and lives only while a turn is in flight.
 */
function broadcast(sessionId: string, event: SseEvent): void {
  const registry = getStreamRegistry();
  const entry = registry.findRunning(sessionId);
  if (!entry) return;
  registry.append(entry.turnId, event);
  for (const listener of entry.listeners) {
    try {
      listener(event);
    } catch {
      /* listener errors must not break the loop */
    }
  }
}

const chatSessionFocusRoutes: FastifyPluginAsync<ChatSessionFocusRouteOptions> = async (
  fastify,
  opts,
) => {
  fastify.get<{ Params: { id: string } }>(
    '/api/chat/sessions/:id/focus',
    async (req, reply) => {
      const ownerId = readOwner(req);
      if (!ownerId) return reply.status(401).send({ error: 'Missing X-Owner-Id header' });

      const session = chatStore.getSession(opts.db, req.params.id);
      if (!session || session.deleted_at != null) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      if (session.owner_id !== ownerId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const focus: SessionFocus = getFocus(opts.db, req.params.id);
      // Surface the SDK resume id existence as a boolean only — the id itself
      // is server-internal and never crosses the API boundary.
      const hasSdkResume = !!session.sdk_conversation_id;
      return reply.send({ focus, hasSdkResume });
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/chat/sessions/:id/focus',
    async (req, reply) => {
      const ownerId = readOwner(req);
      if (!ownerId) return reply.status(401).send({ error: 'Missing X-Owner-Id header' });

      const session = chatStore.getSession(opts.db, req.params.id);
      if (!session || session.deleted_at != null) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      if (session.owner_id !== ownerId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      // Wrap the three writes in a transaction. If any throws, none commit —
      // partial state would leave the user with a half-cleared memory that is
      // visible but unreproducible.
      const tx = opts.db.transaction(() => {
        clearFocus(opts.db, req.params.id);
        chatStore.clearSdkConversationId(opts.db, req.params.id);
        kvEvict(opts.db, 'disambig_resolution', `session:${req.params.id}`);
      });
      tx();

      broadcast(req.params.id, {
        type: 'focus_reset',
        data: { sessionId: req.params.id },
      });

      return reply.status(204).send();
    },
  );

  // Re-export the broadcast helper for the turn handler so it can emit
  // `focus_updated` events without re-implementing the registry lookup. Kept
  // module-private outside the route file so callers can't bypass auth.
  return;
};

/**
 * Emit a `focus_updated` event on whatever stream is currently watching this
 * session. Used by the turn handler after `mergeFocus` lands so the FE chip
 * updates in <200ms without a poll.
 *
 * Best-effort: a focus change with no live listeners is a no-op (the next
 * GET request will see the fresh bag anyway).
 */
export function emitFocusUpdated(sessionId: string, focus: SessionFocus): void {
  broadcast(sessionId, {
    type: 'focus_updated',
    data: { sessionId, focus },
  });
}

/**
 * Identical helper for the writeSseEvent wire format. Exists so a non-SSE
 * caller (e.g. a future webhook) can use the same broadcast path without
 * importing the registry directly.
 */
export function writeFocusEvent(
  stream: Parameters<typeof writeSseEvent>[0],
  event: Extract<SseEvent, { type: 'focus_updated' | 'focus_reset' }>,
): void {
  writeSseEvent(stream, event);
}

export default chatSessionFocusRoutes;
