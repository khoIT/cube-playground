/**
 * Digest-subscriptions CRUD — owner-scoped.
 *
 *   GET    /api/digest-subscriptions?game=<id>  — list caller's subscriptions
 *   POST   /api/digest-subscriptions            — create / upsert a subscription
 *   DELETE /api/digest-subscriptions/:id        — delete a subscription
 *
 * Owner identity: req.user?.username ?? req.user?.email.
 * next_run_at is computed on creation based on cadence (daily = +24h, weekly = +7d).
 */

import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/sqlite.js';

const VALID_CADENCES = new Set(['daily', 'weekly']);

function resolveOwner(req: { user?: { username?: string; email?: string } }): string | null {
  return req.user?.username ?? req.user?.email ?? null;
}

function parseIntParam(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function cadenceMs(cadence: string): number {
  return cadence === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

interface DigestSubRow {
  id: number;
  owner: string;
  game: string;
  metrics_json: string;
  cadence: string;
  channel: string;
  next_run_at: number | null;
  last_run_date: string | null;
  created_at: number;
}

export default async function digestSubscriptionsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/digest-subscriptions?game=<id>
  app.get('/api/digest-subscriptions', async (req, reply) => {
    const owner = resolveOwner(req as Parameters<typeof resolveOwner>[0]);
    if (!owner) return reply.status(401).send({ error: 'unauthenticated' });

    const q = req.query as Record<string, string | undefined>;
    const game = q.game?.trim();
    if (!game) return reply.status(400).send({ error: '`game` query param required' });

    try {
      const db = getDb();
      const rows = db
        .prepare(
          `SELECT * FROM digest_subscriptions WHERE owner = ? AND game = ? ORDER BY id`,
        )
        .all(owner, game) as DigestSubRow[];

      return {
        subscriptions: rows.map((r) => ({
          ...r,
          metrics: safeParseArray(r.metrics_json),
        })),
      };
    } catch (err) {
      app.log.error({ err }, '[digest-subscriptions] list failed');
      return reply.status(500).send({ error: 'internal error' });
    }
  });

  // POST /api/digest-subscriptions
  app.post('/api/digest-subscriptions', async (req, reply) => {
    const owner = resolveOwner(req as Parameters<typeof resolveOwner>[0]);
    if (!owner) return reply.status(401).send({ error: 'unauthenticated' });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const game = typeof body.game === 'string' ? body.game.trim() : '';
    const cadence = typeof body.cadence === 'string' ? body.cadence.trim() : '';
    const metrics = Array.isArray(body.metrics) ? (body.metrics as unknown[]) : [];

    if (!game) return reply.status(400).send({ error: '`game` required' });
    if (!VALID_CADENCES.has(cadence))
      return reply.status(400).send({ error: '`cadence` must be daily or weekly' });
    if (metrics.length === 0)
      return reply.status(400).send({ error: '`metrics` must be a non-empty array' });

    const metricIds = (metrics as unknown[]).filter((m): m is string => typeof m === 'string' && m.trim() !== '');
    if (metricIds.length === 0)
      return reply.status(400).send({ error: '`metrics` must contain valid metric id strings' });

    try {
      const db = getDb();
      const now = Date.now();
      const nextRunAt = now + cadenceMs(cadence);

      const result = db
        .prepare(
          `INSERT INTO digest_subscriptions
             (owner, game, metrics_json, cadence, channel, next_run_at, last_run_date, created_at)
           VALUES (?, ?, ?, ?, 'in_app', ?, NULL, ?)`,
        )
        .run(owner, game, JSON.stringify(metricIds), cadence, nextRunAt, now);

      return reply.status(201).send({ id: result.lastInsertRowid, ok: true });
    } catch (err) {
      app.log.error({ err }, '[digest-subscriptions] create failed');
      return reply.status(500).send({ error: 'internal error' });
    }
  });

  // DELETE /api/digest-subscriptions/:id
  app.delete('/api/digest-subscriptions/:id', async (req, reply) => {
    const owner = resolveOwner(req as Parameters<typeof resolveOwner>[0]);
    if (!owner) return reply.status(401).send({ error: 'unauthenticated' });

    const id = parseIntParam((req.params as Record<string, string>).id);
    if (id === null) return reply.status(400).send({ error: 'invalid id' });

    try {
      const db = getDb();
      const result = db
        .prepare(`DELETE FROM digest_subscriptions WHERE id = ? AND owner = ?`)
        .run(id, owner);
      if (result.changes === 0) return reply.status(404).send({ error: 'not found' });
      return reply.status(204).send();
    } catch (err) {
      app.log.error({ err }, '[digest-subscriptions] delete failed');
      return reply.status(500).send({ error: 'internal error' });
    }
  });
}

function safeParseArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
