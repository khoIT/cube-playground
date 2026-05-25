/**
 * Annotation API — star/flag/note per turn.
 *
 *   POST   /debug/turns/:turnId/annotation  — upsert { starred?, flag?, note? }
 *   DELETE /debug/turns/:turnId/annotation  — remove row
 *
 * Registered as a Fastify plugin under the same /debug prefix as debug.ts.
 * Ownership enforced: caller must own the turn's session (X-Owner-Id).
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { extractOwnerId, getTurnOwnerId } from './debug-shared.js';
import * as annotationsStore from '../db/annotations-store.js';

interface AnnotationRouteOptions {
  db: Database.Database;
}

const FLAG_VALUES = new Set(['bug', 'important', 'review', null, undefined]);

const debugAnnotationRoutes: FastifyPluginAsync<AnnotationRouteOptions> = async (fastify, opts) => {
  const { db } = opts;

  // POST /debug/turns/:turnId/annotation
  fastify.post<{
    Params: { turnId: string };
    Body: { starred?: boolean; flag?: string | null; note?: string | null };
  }>(
    '/debug/turns/:turnId/annotation',
    async (req, reply) => {
      const ownerId = extractOwnerId(req.headers as Record<string, string | string[] | undefined>);
      if (!ownerId) return reply.status(401).send({ error: 'Missing X-Owner-Id header' });

      const turnOwner = getTurnOwnerId(db, req.params.turnId);
      if (turnOwner === null) return reply.status(404).send({ error: 'Turn not found' });
      if (turnOwner !== ownerId) return reply.status(403).send({ error: 'Forbidden' });

      const { starred, flag, note } = req.body ?? {};

      if (flag !== undefined && !FLAG_VALUES.has(flag)) {
        return reply.status(400).send({ error: 'flag must be one of: bug, important, review, null' });
      }

      const row = annotationsStore.upsertAnnotation(db, req.params.turnId, ownerId, {
        ...(starred !== undefined && { starred }),
        ...('flag' in (req.body ?? {}) && { flag }),
        ...('note' in (req.body ?? {}) && { note }),
      });

      return reply.status(200).send({
        turnId: row.turn_id,
        starred: row.starred === 1,
        flag: row.flag,
        note: row.note,
        updatedAt: row.updated_at,
      });
    },
  );

  // DELETE /debug/turns/:turnId/annotation
  fastify.delete<{ Params: { turnId: string } }>(
    '/debug/turns/:turnId/annotation',
    async (req, reply) => {
      const ownerId = extractOwnerId(req.headers as Record<string, string | string[] | undefined>);
      if (!ownerId) return reply.status(401).send({ error: 'Missing X-Owner-Id header' });

      const turnOwner = getTurnOwnerId(db, req.params.turnId);
      if (turnOwner === null) return reply.status(404).send({ error: 'Turn not found' });
      if (turnOwner !== ownerId) return reply.status(403).send({ error: 'Forbidden' });

      annotationsStore.deleteAnnotation(db, req.params.turnId, ownerId);
      return reply.status(204).send();
    },
  );
};

export default debugAnnotationRoutes;
