/**
 * Chart annotation REST endpoints.
 *
 *   GET    /api/annotations?game=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD
 *   POST   /api/annotations                           body: InsertAnnotationInput
 *   PATCH  /api/annotations/:id                       body: UpdateAnnotationInput
 *   DELETE /api/annotations/:id
 *
 * Write routes are gated by the already-registered enforceWriteRoles middleware.
 * Input is validated at the boundary; malformed requests return 400.
 */

import type { FastifyInstance } from 'fastify';
import {
  listAnnotations,
  insertAnnotation,
  updateAnnotation,
  deleteAnnotation,
} from '../services/annotation-store.js';
import type { AnnotationType, InsertAnnotationInput, UpdateAnnotationInput } from '../services/annotation-store.js';

const VALID_TYPES = new Set<AnnotationType>(['patch', 'event', 'campaign', 'incident']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: unknown): s is string {
  return typeof s === 'string' && ISO_DATE_RE.test(s);
}

function parseId(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default async function annotationsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/annotations?game=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD
  app.get('/api/annotations', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const game = q.game?.trim();
    if (!game) {
      return reply.status(400).send({ error: '`game` query param required' });
    }
    const from = q.from?.trim();
    const to = q.to?.trim();
    if (from && !isValidDate(from)) {
      return reply.status(400).send({ error: '`from` must be YYYY-MM-DD' });
    }
    if (to && !isValidDate(to)) {
      return reply.status(400).send({ error: '`to` must be YYYY-MM-DD' });
    }

    try {
      const annotations = listAnnotations({ game, from, to });
      return { annotations, game };
    } catch (err) {
      app.log.error({ err }, '[annotations] list failed');
      return reply.status(500).send({ error: 'internal error' });
    }
  });

  // POST /api/annotations
  app.post('/api/annotations', async (req, reply) => {
    const body = req.body as Record<string, unknown> | null | undefined;
    if (!body) {
      return reply.status(400).send({ error: 'request body required' });
    }

    const type = body.type as string | undefined;
    if (!type || !VALID_TYPES.has(type as AnnotationType)) {
      return reply.status(400).send({ error: '`type` must be one of: patch, event, campaign, incident' });
    }
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return reply.status(400).send({ error: '`title` is required' });
    }
    const starts_at = body.starts_at as string | undefined;
    if (!isValidDate(starts_at)) {
      return reply.status(400).send({ error: '`starts_at` must be YYYY-MM-DD' });
    }
    const ends_at = body.ends_at ?? null;
    if (ends_at !== null && !isValidDate(ends_at)) {
      return reply.status(400).send({ error: '`ends_at` must be YYYY-MM-DD or null' });
    }
    const url = typeof body.url === 'string' ? body.url.trim() : null;

    const game = typeof body.game === 'string' ? body.game.trim() || null : null;
    const created_by = (req as unknown as { workspace?: { id?: string } }).workspace?.id
      ?? (typeof body.created_by === 'string' ? body.created_by : null);

    const input: InsertAnnotationInput = {
      game,
      type: type as AnnotationType,
      title,
      starts_at,
      ends_at: ends_at as string | null,
      url,
      created_by,
    };

    try {
      const row = insertAnnotation(input);
      return reply.status(201).send({ annotation: row });
    } catch (err) {
      app.log.error({ err }, '[annotations] insert failed');
      return reply.status(500).send({ error: 'internal error' });
    }
  });

  // PATCH /api/annotations/:id
  app.patch('/api/annotations/:id', async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    if (id === null) {
      return reply.status(400).send({ error: 'invalid annotation id' });
    }
    const body = req.body as Record<string, unknown> | null | undefined;
    if (!body) {
      return reply.status(400).send({ error: 'request body required' });
    }

    const input: UpdateAnnotationInput = {};
    if ('type' in body) {
      const t = body.type as string;
      if (!VALID_TYPES.has(t as AnnotationType)) {
        return reply.status(400).send({ error: '`type` must be one of: patch, event, campaign, incident' });
      }
      input.type = t as AnnotationType;
    }
    if ('title' in body) {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) return reply.status(400).send({ error: '`title` cannot be empty' });
      input.title = title;
    }
    if ('starts_at' in body) {
      if (!isValidDate(body.starts_at)) {
        return reply.status(400).send({ error: '`starts_at` must be YYYY-MM-DD' });
      }
      input.starts_at = body.starts_at as string;
    }
    if ('ends_at' in body) {
      const ea = body.ends_at;
      if (ea !== null && !isValidDate(ea)) {
        return reply.status(400).send({ error: '`ends_at` must be YYYY-MM-DD or null' });
      }
      input.ends_at = ea as string | null;
    }
    if ('url' in body) {
      input.url = typeof body.url === 'string' ? body.url.trim() || null : null;
    }

    try {
      const row = updateAnnotation(id, input);
      if (!row) return reply.status(404).send({ error: 'annotation not found' });
      return { annotation: row };
    } catch (err) {
      app.log.error({ err }, '[annotations] update failed');
      return reply.status(500).send({ error: 'internal error' });
    }
  });

  // DELETE /api/annotations/:id
  app.delete('/api/annotations/:id', async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    if (id === null) {
      return reply.status(400).send({ error: 'invalid annotation id' });
    }
    try {
      const deleted = deleteAnnotation(id);
      if (!deleted) return reply.status(404).send({ error: 'annotation not found' });
      return { ok: true, id };
    } catch (err) {
      app.log.error({ err }, '[annotations] delete failed');
      return reply.status(500).send({ error: 'internal error' });
    }
  });
}
