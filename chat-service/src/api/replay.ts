/**
 * GET /agent/turn/:turnId/stream?from=<offset>
 *
 * Refresh-resume endpoint. Streams buffered events from `from` then tails
 * the live registry until the turn finishes or the client disconnects.
 *
 * Response codes:
 *   200 text/event-stream — replay + live tail
 *   403 — caller does not own the session this turn belongs to
 *   404 — turnId unknown (expired from TTL or never registered)
 *   409 — `from` < entry.startOffset (ring overflow); body includes
 *         `availableFromOffset` so the client can retry from the latest
 *         contiguous frame.
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import * as chatStore from '../db/chat-store.js';
import { writeSseEvent } from '../core/sse-stream.js';
import { getStreamRegistry } from '../core/stream-registry-instance.js';

interface ReplayRouteOptions {
  db: Database.Database;
}

const replayRoutes: FastifyPluginAsync<ReplayRouteOptions> = async (fastify, opts) => {
  fastify.get<{ Params: { turnId: string }; Querystring: { from?: string } }>(
    '/agent/turn/:turnId/stream',
    async (req, reply) => {
      const ownerId = req.headers['x-owner-id'];
      if (!ownerId || typeof ownerId !== 'string') {
        return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      }

      const registry = getStreamRegistry();
      const entry = registry.get(req.params.turnId);
      if (!entry) {
        return reply.status(404).send({ error: 'Unknown or expired turn' });
      }

      // Ownership check — the session row the turn references must belong
      // to the requesting owner.
      const session = chatStore.getSession(opts.db, entry.sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      if (session.owner_id !== ownerId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      // Validate the replay offset. Absent → 0 (replay from the ring tail). A
      // present-but-malformed value (negative, fractional, non-numeric) is a
      // client bug → 400, not a silent coerce that mis-reports as ring_overflow.
      let from = 0;
      if (req.query.from !== undefined) {
        const parsed = Number(req.query.from);
        if (!Number.isInteger(parsed) || parsed < 0) {
          return reply.status(400).send({ code: 'bad_offset', error: 'from must be a non-negative integer' });
        }
        from = parsed;
      }

      // Overflow: requested offset older than the ring's tail.
      if (from < entry.startOffset) {
        return reply.status(409).send({
          code: 'ring_overflow',
          availableFromOffset: entry.startOffset,
          totalEmitted: entry.totalEmitted,
        });
      }

      // SSE response.
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.hijack();
      const stream = reply.raw;

      // Write buffered events from `from` onward. Each entry.events index
      // corresponds to (startOffset + i) absolute offset.
      //
      // SAFETY: the replay loop + subscribe() below are race-free ONLY because
      // both `writeSseEvent` and `registry.append` run synchronously on the
      // same event loop tick. If `writeSseEvent` ever becomes async (e.g.
      // backpressure-aware), an `append` could interleave between the loop
      // and the subscribe — events appended in that window would be missed.
      // Mitigation in that future world: snapshot `entry.events.slice()` +
      // `entry.totalEmitted` BEFORE the loop, OR subscribe with a temporary
      // buffer first then flush replay + buffered tail.
      const localStart = Math.max(0, from - entry.startOffset);
      for (let i = localStart; i < entry.events.length; i++) {
        writeSseEvent(stream, entry.events[i]!);
      }

      // If terminal, end immediately after replay.
      if (entry.status !== 'running') {
        stream.end();
        return;
      }

      // Tail live: subscribe; unsubscribe on socket close.
      const unsubscribe = registry.subscribe(entry.turnId, (event) => {
        try {
          writeSseEvent(stream, event);
          // Auto-close after `done`/`error` so the client gets EOF cleanly.
          if (event.type === 'done' || event.type === 'error') {
            stream.end();
          }
        } catch {
          stream.end();
        }
      });

      stream.on('close', () => {
        unsubscribe();
      });
    },
  );
};

export default replayRoutes;
