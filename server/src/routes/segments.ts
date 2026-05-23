/**
 * Segment CRUD routes + append + refresh stub.
 * Owner enforcement: writes reject when row.owner !== request.owner.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/sqlite.js';
import { treeToCubeFilters } from '../services/translator.js';
import { predicateToSql } from '../services/predicate-to-sql.js';
import type { PredicateNode } from '../types/predicate-tree.js';
import { parseUidCsv, MAX_ROWS } from '../services/csv-importer.js';
import { enqueueRefresh } from '../jobs/refresh-queue.js';
import { getCardCache } from '../services/card-cache-store.js';
import { loadGamesConfig } from '../services/games-config-loader.js';

const segmentInputSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['manual', 'predicate']),
  cube: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  predicate_tree: z.unknown().optional().nullable(),
  uid_list: z.array(z.string()).optional(),
  refresh_cadence_min: z.number().int().positive().nullable().optional(),
  game_id: z.string().min(1).max(64).optional(),
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

  let activations: unknown[] = [];
  try {
    activations = JSON.parse((row.activations_json as string) ?? '[]');
    if (!Array.isArray(activations)) activations = [];
  } catch {
    activations = [];
  }

  return {
    ...row,
    tags,
    predicate_tree: row.predicate_tree_json
      ? JSON.parse(row.predicate_tree_json as string)
      : null,
    uid_list: JSON.parse((row.uid_list_json as string) ?? '[]'),
    activations,
  };
}

const VALID_ENVS = new Set(['dev', 'stag', 'prod']);
const METRIC_NAME_RE = /^[a-z0-9_]{1,64}$/;

export default async function segmentsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/segments
  app.get('/api/segments', async (req, reply) => {
    const { owner, type, q, sort, game_id } = req.query as Record<string, string | undefined>;
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
    if (game_id) {
      sql += ' AND game_id = ?';
      params.push(game_id);
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
         uid_count, uid_list_json, refresh_cadence_min, created_at, updated_at, game_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
      data.game_id ?? loadGamesConfig().defaultGameId,
    );

    if (data.tags?.length) {
      const insertTag = db.prepare('INSERT OR IGNORE INTO segment_tags (segment_id, tag) VALUES (?,?)');
      for (const tag of data.tags) insertTag.run(id, tag);
    }

    const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown>;
    return reply.status(201).send(hydrateSegment(row, db));
  });

  // GET /api/segments/:id — includes prerendered card_cache for one-shot hydration
  app.get('/api/segments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Segment not found' } });
    return { ...hydrateSegment(row, db), card_cache: getCardCache(id) };
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

  // POST /api/segments/import-ids — CSV → static segment
  // Accepts JSON: { name, cube, csv, tags? } where csv is the raw CSV text.
  // (Multipart upload deferred — FE reads the file client-side and posts text.)
  app.post('/api/segments/import-ids', async (req, reply) => {
    const body = req.body as {
      name?: string;
      cube?: string;
      csv?: string;
      tags?: string[];
      game_id?: string;
    };

    if (!body?.name?.trim()) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'name required' } });
    }
    if (!body.cube?.trim()) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'cube required' } });
    }
    if (typeof body.csv !== 'string' || body.csv.length === 0) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'csv required' } });
    }

    const db = getDb();
    const mapping = db
      .prepare('SELECT identity_field FROM cube_identity_map WHERE cube = ?')
      .get(body.cube) as { identity_field: string } | undefined;
    if (!mapping) {
      return reply.status(400).send({
        error: {
          code: 'IDENTITY_DIM_MISSING',
          message: `cube "${body.cube}" has no identity-dim mapping. Set it in Settings.`,
        },
      });
    }

    const parsed = parseUidCsv(body.csv);
    if (parsed.uids.length === 0) {
      return reply.status(400).send({
        error: {
          code: 'EMPTY_CSV',
          message: 'no valid uids found in csv',
          details: parsed.errors,
        },
      });
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const owner = req.owner;

    db.prepare(`
      INSERT INTO segments
        (id, name, type, owner, status, cube, predicate_tree_json, cube_query_json,
         uid_count, uid_list_json, refresh_cadence_min, created_at, updated_at, game_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      body.name.trim(),
      'manual',
      owner,
      'fresh',
      body.cube,
      null,
      null,
      parsed.uids.length,
      JSON.stringify(parsed.uids),
      null,
      now,
      now,
      body.game_id ?? loadGamesConfig().defaultGameId,
    );

    if (body.tags?.length) {
      const insertTag = db.prepare('INSERT OR IGNORE INTO segment_tags (segment_id, tag) VALUES (?,?)');
      for (const tag of body.tags) insertTag.run(id, tag);
    }

    return reply.status(201).send({
      id,
      uid_count: parsed.uids.length,
      truncated: parsed.truncated,
      max_rows: MAX_ROWS,
      errors: parsed.errors,
    });
  });

  // GET /api/segments/:id/refresh-log — sparkline + history feed.
  app.get('/api/segments/:id/refresh-log', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { days, limit } = req.query as Record<string, string | undefined>;
    const db = getDb();
    const exists = db.prepare('SELECT 1 FROM segments WHERE id = ?').get(id);
    if (!exists) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Segment not found' } });

    const dayCount = Math.max(1, Math.min(parseInt(days ?? '7', 10) || 7, 90));
    const rowLimit = Math.max(1, Math.min(parseInt(limit ?? '200', 10) || 200, 500));
    const rows = db
      .prepare(
        `SELECT id, segment_id, ts, uid_count, status
           FROM segment_refresh_log
          WHERE segment_id = ? AND ts >= datetime('now', ? )
          ORDER BY ts ASC
          LIMIT ?`,
      )
      .all(id, `-${dayCount} days`, rowLimit);
    return rows;
  });

  // POST /api/segments/refresh-logs — bulk fetch for library sparklines.
  // Body: { ids: string[], days: number }. Returns Record<id, LogRow[]>.
  app.post('/api/segments/refresh-logs', async (req, reply) => {
    const body = req.body as { ids?: unknown; days?: unknown };
    if (!Array.isArray(body?.ids)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'ids must be an array' } });
    }
    const ids = (body.ids as unknown[])
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .slice(0, 100); // cap to prevent DoS
    if (ids.length === 0) return {};

    const days = Math.max(1, Math.min(parseInt(String(body.days ?? '7'), 10) || 7, 90));
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT id, segment_id, ts, uid_count, status
           FROM segment_refresh_log
          WHERE segment_id IN (${placeholders}) AND ts >= datetime('now', ?)
          ORDER BY ts ASC`,
      )
      .all(...ids, `-${days} days`) as Array<Record<string, unknown>>;

    const grouped: Record<string, Array<Record<string, unknown>>> = {};
    for (const id of ids) grouped[id] = [];
    for (const r of rows) {
      const sid = r.segment_id as string;
      if (!grouped[sid]) grouped[sid] = [];
      grouped[sid].push(r);
    }
    return grouped;
  });

  // GET /api/segments/:id/sql-filter — Advanced preview in Activate-to-CDP modal.
  app.get('/api/segments/:id/sql-filter', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = db.prepare('SELECT predicate_tree_json FROM segments WHERE id = ?').get(id) as
      | { predicate_tree_json: string | null }
      | undefined;
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Segment not found' } });
    if (!row.predicate_tree_json) return { filter: '1=1' };
    try {
      const tree = JSON.parse(row.predicate_tree_json) as PredicateNode;
      return { filter: predicateToSql(tree) };
    } catch (err) {
      return reply.status(400).send({
        error: { code: 'SQL_TRANSLATOR_ERROR', message: (err as Error).message },
      });
    }
  });

  // POST /api/segments/:id/refresh — enqueue manual refresh; cron worker drains.
  app.post('/api/segments/:id/refresh', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = db.prepare('SELECT type FROM segments WHERE id = ?').get(id) as { type: string } | undefined;
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Segment not found' } });
    if (row.type !== 'predicate') {
      return reply.status(400).send({ error: { code: 'NOT_LIVE', message: 'Only predicate (live) segments can be refreshed' } });
    }

    db.prepare("UPDATE segments SET status = 'refreshing', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);

    // Fire-and-forget — queue runs in background.
    void enqueueRefresh(id);

    return reply.status(202).send({ status: 'refreshing' });
  });

  // POST /api/segments/:id/activations — append a new activation (stub).
  // Real CDP wiring lands in Phase 7; this endpoint persists the registry entry.
  app.post('/api/segments/:id/activations', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as {
      destination?: string;
      game_id?: string;
      env?: string;
      metric_name?: string;
      status?: string;
      last_error?: string;
    };
    if (body.destination !== undefined && body.destination !== 'cdp') {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'destination must be "cdp"' } });
    }
    if (!body.env || !VALID_ENVS.has(body.env)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'env must be dev|stag|prod' } });
    }
    if (!body.metric_name || !METRIC_NAME_RE.test(body.metric_name)) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: 'metric_name must match /^[a-z0-9_]{1,64}$/' },
      });
    }

    const db = getDb();
    const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Segment not found' } });
    if (row.owner !== req.owner) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Not your segment' } });

    let list: Array<Record<string, unknown>> = [];
    try {
      list = JSON.parse((row.activations_json as string) ?? '[]');
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }

    const activation = {
      id: uuidv4(),
      destination: 'cdp' as const,
      game_id: body.game_id ?? (row.game_id as string) ?? loadGamesConfig().defaultGameId,
      env: body.env,
      metric_name: body.metric_name,
      registered_at: new Date().toISOString(),
      last_pushed_at: null,
      status: (body.status as string) || 'pending',
      ...(body.last_error ? { last_error: body.last_error } : {}),
    };
    list.push(activation);

    db.prepare('UPDATE segments SET activations_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(list),
      new Date().toISOString(),
      id,
    );

    const updated = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown>;
    return reply.status(201).send(hydrateSegment(updated, db));
  });

  // DELETE /api/segments/:id/activations/:activationId — remove an activation.
  app.delete('/api/segments/:id/activations/:activationId', async (req, reply) => {
    const { id, activationId } = req.params as { id: string; activationId: string };
    const db = getDb();
    const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Segment not found' } });
    if (row.owner !== req.owner) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Not your segment' } });

    let list: Array<Record<string, unknown>> = [];
    try {
      list = JSON.parse((row.activations_json as string) ?? '[]');
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
    const next = list.filter((a) => (a as { id?: string }).id !== activationId);
    db.prepare('UPDATE segments SET activations_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(next),
      new Date().toISOString(),
      id,
    );

    const updated = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown>;
    return hydrateSegment(updated, db);
  });
}
