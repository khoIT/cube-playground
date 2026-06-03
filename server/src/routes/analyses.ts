/**
 * Segment analyses CRUD — saved Cube queries pinned to a segment.
 * Nested under /api/segments/:segmentId/analyses.
 *
 * Authorization: analyses inherit the parent segment's visibility boundary. A
 * personal segment's analyses are readable/mutable only by the owner (sub) or an
 * admin; shared/org segments stay workspace-collaborative. Same predicate as the
 * segment routes — never reachable for a segment the caller can't see.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/sqlite.js';
import { canAccessSegment, canMutateSegment } from '../auth/can-access-segment.js';

/**
 * Enforce the parent segment's workspace + visibility boundary before touching
 * its analyses. Returns true if permitted; otherwise sends the reply (404 for
 * unknown/cross-workspace, 403 for visibility-denied) and returns false.
 */
function guardParentSegment(
  req: FastifyRequest,
  reply: FastifyReply,
  segmentId: string,
  mode: 'read' | 'mutate',
): boolean {
  const row = getDb()
    .prepare('SELECT owner, visibility, workspace FROM segments WHERE id = ?')
    .get(segmentId) as { owner: string; visibility: string | null; workspace: string } | undefined;
  if (!row || row.workspace !== req.workspace.id) {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Segment not found' } });
    return false;
  }
  const allowed = mode === 'read' ? canAccessSegment(req.principal, row) : canMutateSegment(req.principal, row);
  if (!allowed) {
    reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Not permitted for this segment' } });
    return false;
  }
  return true;
}

const analysisInputSchema = z.object({
  title: z.string().min(1),
  query_json: z.string().optional().nullable(),
  layout_json: z.string().optional().nullable(),
});

const analysisPatchSchema = z.object({
  title: z.string().min(1).optional(),
  query_json: z.string().optional().nullable(),
  layout_json: z.string().optional().nullable(),
});

export default async function analysesRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/segments/:segmentId/analyses
  app.get('/api/segments/:segmentId/analyses', async (req, reply) => {
    const { segmentId } = req.params as { segmentId: string };
    const db = getDb();

    if (!guardParentSegment(req, reply, segmentId, 'read')) return reply;

    return db.prepare('SELECT * FROM segment_analyses WHERE segment_id = ? ORDER BY created_at DESC').all(segmentId);
  });

  // POST /api/segments/:segmentId/analyses
  app.post('/api/segments/:segmentId/analyses', async (req, reply) => {
    const { segmentId } = req.params as { segmentId: string };
    const db = getDb();

    if (!guardParentSegment(req, reply, segmentId, 'mutate')) return reply;

    const parsed = analysisInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }

    const { title, query_json, layout_json } = parsed.data;
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO segment_analyses (id, segment_id, title, owner, query_json, layout_json, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id, segmentId, title, req.owner, query_json ?? null, layout_json ?? null, now, now);

    return reply.status(201).send(
      db.prepare('SELECT * FROM segment_analyses WHERE id = ?').get(id),
    );
  });

  // GET /api/segments/:segmentId/analyses/:id
  app.get('/api/segments/:segmentId/analyses/:id', async (req, reply) => {
    const { segmentId, id } = req.params as { segmentId: string; id: string };
    const db = getDb();

    if (!guardParentSegment(req, reply, segmentId, 'read')) return reply;
    const row = db.prepare('SELECT * FROM segment_analyses WHERE id = ? AND segment_id = ?').get(id, segmentId);
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Analysis not found' } });
    return row;
  });

  // PATCH /api/segments/:segmentId/analyses/:id
  app.patch('/api/segments/:segmentId/analyses/:id', async (req, reply) => {
    const { segmentId, id } = req.params as { segmentId: string; id: string };
    const db = getDb();

    if (!guardParentSegment(req, reply, segmentId, 'mutate')) return reply;
    const row = db.prepare('SELECT * FROM segment_analyses WHERE id = ? AND segment_id = ?').get(id, segmentId) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Analysis not found' } });

    const parsed = analysisPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }

    const patch = parsed.data;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE segment_analyses SET title = ?, query_json = ?, layout_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      patch.title ?? row.title,
      patch.query_json !== undefined ? patch.query_json : row.query_json,
      patch.layout_json !== undefined ? patch.layout_json : row.layout_json,
      now,
      id,
    );

    return db.prepare('SELECT * FROM segment_analyses WHERE id = ?').get(id);
  });

  // DELETE /api/segments/:segmentId/analyses/:id
  app.delete('/api/segments/:segmentId/analyses/:id', async (req, reply) => {
    const { segmentId, id } = req.params as { segmentId: string; id: string };
    const db = getDb();

    if (!guardParentSegment(req, reply, segmentId, 'mutate')) return reply;
    const row = db.prepare('SELECT * FROM segment_analyses WHERE id = ? AND segment_id = ?').get(id, segmentId) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Analysis not found' } });

    db.prepare('DELETE FROM segment_analyses WHERE id = ?').run(id);
    return reply.status(204).send();
  });
}
