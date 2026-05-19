/**
 * Segment CRUD routes + append + refresh stub.
 * Owner enforcement: writes reject when row.owner !== request.owner.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/sqlite.js';
import { treeToCubeFilters } from '../services/translator.js';
import type { PredicateNode } from '../types/predicate-tree.js';

const segmentInputSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['manual', 'predicate']),
  cube: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  predicate_tree: z.unknown().optional().nullable(),
  uid_list: z.array(z.string()).optional(),
  refresh_cadence_min: z.number().int().positive().nullable().optional(),
});

const segmentPatchSchema = z.object({
  name: z.string().min(1).optional(),
  cube: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  predicate_tree: z.unknown().optional().nullable(),
  uid_list: z.array(z.string()).optional(),
  refresh_cadence_min: z.number().int().positive().nullable().optional(),
});

function apiError(code: string, message: string, status: number) {
  return { statusCode: status, body: { error: { code, message } } };
}

function hydrateSegment(row: Record<string, unknown>, db: ReturnType<typeof getDb>) {
  const tags = (
    db.prepare('SELECT tag FROM segment_tags WHERE segment_id = ?').all(row.id) as { tag: string }[]
  ).map((r) => r.tag);

  return {
    ...row,
    tags,
    predicate_tree: row.predicate_tree_json
      ? JSON.parse(row.predicate_tree_json as string)
      : null,
    uid_list: JSON.parse((row.uid_list_json as string) ?? '[]'),
  };
}

export default async function segmentsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/segments
  app.get('/api/segments', async (req, reply) => {
    const { owner, type, q, sort } = req.query as Record<string, string | undefined>;
    const db = getDb();

    let sql = 'SELECT * FROM segments WHERE 1=1';
    const params: unknown[] = [];

    if (owner && owner !== '*') {
      sql += ' AND owner = ?';
      params.push(owner);
    }
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    if (q) {
      sql += ' AND name LIKE ?';
      params.push(`%${q}%`);
    }

    const orderCol = sort === 'name' ? 'name' : 'created_at';
    sql += ` ORDER BY ${orderCol} DESC`;

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => hydrateSegment(r, db));
  });

  // POST /api/segments
  app.post('/api/segments', async (req, reply) => {
    const parsed = segmentInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }

    const data = parsed.data;
    const db = getDb();
    const id = uuidv4();
    const now = new Date().toISOString();
    const owner = req.owner;

    let cubeQueryJson: string | null = null;
    if (data.predicate_tree) {
      try {
        const filters = treeToCubeFilters(data.predicate_tree as PredicateNode);
        cubeQueryJson = JSON.stringify({ filters });
      } catch (err) {
        return reply.status(400).send({
          error: { code: 'TRANSLATOR_ERROR', message: (err as Error).message },
        });
      }
    }

    const uidList = data.uid_list ?? [];

    db.prepare(`
      INSERT INTO segments
        (id, name, type, owner, status, cube, predicate_tree_json, cube_query_json,
         uid_count, uid_list_json, refresh_cadence_min, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      data.name,
      data.type,
      owner,
      'fresh',
      data.cube ?? null,
      data.predicate_tree ? JSON.stringify(data.predicate_tree) : null,
      cubeQueryJson,
      uidList.length,
      JSON.stringify(uidList),
      data.refresh_cadence_min ?? null,
      now,
      now,
    );

    if (data.tags?.length) {
      const insertTag = db.prepare('INSERT OR IGNORE INTO segment_tags (segment_id, tag) VALUES (?,?)');
      for (const tag of data.tags) insertTag.run(id, tag);
    }

    const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown>;
    return reply.status(201).send(hydrateSegment(row, db));
  });

  // GET /api/segments/:id
  app.get('/api/segments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Segment not found' } });
    return hydrateSegment(row, db);
  });

  // PATCH /api/segments/:id
  app.patch('/api/segments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Segment not found' } });
    if (row.owner !== req.owner) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Not your segment' } });

    const parsed = segmentPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }

    const patch = parsed.data;
    const now = new Date().toISOString();

    let cubeQueryJson = row.cube_query_json as string | null;
    if (patch.predicate_tree !== undefined) {
      if (patch.predicate_tree) {
        try {
          const filters = treeToCubeFilters(patch.predicate_tree as PredicateNode);
          cubeQueryJson = JSON.stringify({ filters });
        } catch (err) {
          return reply.status(400).send({
            error: { code: 'TRANSLATOR_ERROR', message: (err as Error).message },
          });
        }
      } else {
        cubeQueryJson = null;
      }
    }

    const uidList = patch.uid_list !== undefined
      ? patch.uid_list
      : JSON.parse((row.uid_list_json as string) ?? '[]');

    db.prepare(`
      UPDATE segments SET
        name = ?, cube = ?, predicate_tree_json = ?, cube_query_json = ?,
        uid_count = ?, uid_list_json = ?, refresh_cadence_min = ?, updated_at = ?
      WHERE id = ?
    `).run(
      patch.name ?? row.name,
      patch.cube !== undefined ? patch.cube : row.cube,
      patch.predicate_tree !== undefined ? (patch.predicate_tree ? JSON.stringify(patch.predicate_tree) : null) : row.predicate_tree_json,
      cubeQueryJson,
      uidList.length,
      JSON.stringify(uidList),
      patch.refresh_cadence_min !== undefined ? patch.refresh_cadence_min : row.refresh_cadence_min,
      now,
      id,
    );

    if (patch.tags !== undefined) {
      db.prepare('DELETE FROM segment_tags WHERE segment_id = ?').run(id);
      const insertTag = db.prepare('INSERT OR IGNORE INTO segment_tags (segment_id, tag) VALUES (?,?)');
      for (const tag of patch.tags) insertTag.run(id, tag);
    }

    const updated = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown>;
    return hydrateSegment(updated, db);
  });

  // DELETE /api/segments/:id
  app.delete('/api/segments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Segment not found' } });
    if (row.owner !== req.owner) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Not your segment' } });

    db.prepare('DELETE FROM segments WHERE id = ?').run(id);
    return reply.status(204).send();
  });

  // POST /api/segments/:id/append
  app.post('/api/segments/:id/append', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { uids?: string[] };
    if (!Array.isArray(body?.uids)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'uids must be an array' } });
    }

    const db = getDb();
    const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Segment not found' } });

    const existing: string[] = JSON.parse((row.uid_list_json as string) ?? '[]');
    const merged = Array.from(new Set([...existing, ...body.uids]));

    db.prepare('UPDATE segments SET uid_list_json = ?, uid_count = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(merged), merged.length, new Date().toISOString(), id);

    return { uid_count: merged.length };
  });

  // POST /api/segments/:id/refresh  (stub — cron worker executes the real refresh)
  app.post('/api/segments/:id/refresh', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Segment not found' } });

    db.prepare("UPDATE segments SET status = 'refreshing', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);

    return reply.status(202).send({ status: 'refreshing' });
  });
}
