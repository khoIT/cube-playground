/**
 * Alert-rules CRUD — owner-scoped.
 *
 *   GET    /api/alert-rules?game=<id>      — list caller's rules for a game
 *   POST   /api/alert-rules                — create a rule
 *   PATCH  /api/alert-rules/:id            — update enabled/threshold/comparator
 *   DELETE /api/alert-rules/:id            — delete a rule
 *
 * Owner identity: req.user?.username ?? req.user?.email (same as advisor history).
 * Callers can only read/modify their OWN rules — the owner column is set from
 * the resolved identity, never from the request body.
 */

import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/sqlite.js';
import type { AlertRule } from '../services/alert-rule-engine.js';

const VALID_COMPARATORS = new Set(['<', '>', '<=', '>=', 'pct_drop', 'pct_rise']);

function resolveOwner(req: { user?: { username?: string; email?: string } }): string | null {
  return req.user?.username ?? req.user?.email ?? null;
}

function parseIntParam(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export default async function alertRulesRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/alert-rules?game=<id>
  app.get('/api/alert-rules', async (req, reply) => {
    const owner = resolveOwner(req as Parameters<typeof resolveOwner>[0]);
    if (!owner) return reply.status(401).send({ error: 'unauthenticated' });

    const q = req.query as Record<string, string | undefined>;
    const game = q.game?.trim();
    if (!game) return reply.status(400).send({ error: '`game` query param required' });

    try {
      const db = getDb();
      const rows = db
        .prepare(`SELECT * FROM alert_rules WHERE owner = ? AND game = ? ORDER BY id`)
        .all(owner, game) as AlertRule[];
      return { rules: rows };
    } catch (err) {
      app.log.error({ err }, '[alert-rules] list failed');
      return reply.status(500).send({ error: 'internal error' });
    }
  });

  // POST /api/alert-rules
  app.post('/api/alert-rules', async (req, reply) => {
    const owner = resolveOwner(req as Parameters<typeof resolveOwner>[0]);
    if (!owner) return reply.status(401).send({ error: 'unauthenticated' });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const game = typeof body.game === 'string' ? body.game.trim() : '';
    const metric = typeof body.metric === 'string' ? body.metric.trim() : '';
    const comparator = typeof body.comparator === 'string' ? body.comparator.trim() : '';
    const threshold = typeof body.threshold === 'number' ? body.threshold : null;
    const window = typeof body.window === 'string' ? body.window.trim() : null;

    if (!game) return reply.status(400).send({ error: '`game` required' });
    if (!metric) return reply.status(400).send({ error: '`metric` required' });
    if (!VALID_COMPARATORS.has(comparator))
      return reply.status(400).send({ error: `\`comparator\` must be one of: ${[...VALID_COMPARATORS].join(', ')}` });
    if (threshold == null || !Number.isFinite(threshold))
      return reply.status(400).send({ error: '`threshold` must be a number' });

    try {
      const db = getDb();
      const now = Date.now();
      const result = db
        .prepare(
          `INSERT INTO alert_rules (owner, game, metric, comparator, threshold, window, channel, enabled, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'in_app', 1, ?)`,
        )
        .run(owner, game, metric, comparator, threshold, window ?? null, now);
      return reply.status(201).send({ id: result.lastInsertRowid, ok: true });
    } catch (err) {
      app.log.error({ err }, '[alert-rules] create failed');
      return reply.status(500).send({ error: 'internal error' });
    }
  });

  // PATCH /api/alert-rules/:id
  app.patch('/api/alert-rules/:id', async (req, reply) => {
    const owner = resolveOwner(req as Parameters<typeof resolveOwner>[0]);
    if (!owner) return reply.status(401).send({ error: 'unauthenticated' });

    const id = parseIntParam((req.params as Record<string, string>).id);
    if (id === null) return reply.status(400).send({ error: 'invalid id' });

    const body = (req.body ?? {}) as Record<string, unknown>;

    try {
      const db = getDb();
      const existing = db
        .prepare(`SELECT * FROM alert_rules WHERE id = ? AND owner = ?`)
        .get(id, owner) as AlertRule | undefined;
      if (!existing) return reply.status(404).send({ error: 'not found' });

      // Allow partial updates — only the provided fields are changed.
      const enabled =
        typeof body.enabled === 'number'
          ? body.enabled
          : typeof body.enabled === 'boolean'
          ? body.enabled ? 1 : 0
          : existing.enabled;
      const threshold =
        typeof body.threshold === 'number' && Number.isFinite(body.threshold)
          ? body.threshold
          : existing.threshold;
      const comparator =
        typeof body.comparator === 'string' && VALID_COMPARATORS.has(body.comparator)
          ? body.comparator
          : existing.comparator;
      const windowVal =
        'window' in body
          ? (typeof body.window === 'string' ? body.window.trim() : null)
          : existing.window;

      db.prepare(
        `UPDATE alert_rules SET enabled = ?, threshold = ?, comparator = ?, window = ? WHERE id = ?`,
      ).run(enabled, threshold, comparator, windowVal, id);

      return { ok: true, id };
    } catch (err) {
      app.log.error({ err }, '[alert-rules] patch failed');
      return reply.status(500).send({ error: 'internal error' });
    }
  });

  // DELETE /api/alert-rules/:id
  app.delete('/api/alert-rules/:id', async (req, reply) => {
    const owner = resolveOwner(req as Parameters<typeof resolveOwner>[0]);
    if (!owner) return reply.status(401).send({ error: 'unauthenticated' });

    const id = parseIntParam((req.params as Record<string, string>).id);
    if (id === null) return reply.status(400).send({ error: 'invalid id' });

    try {
      const db = getDb();
      const result = db
        .prepare(`DELETE FROM alert_rules WHERE id = ? AND owner = ?`)
        .run(id, owner);
      if (result.changes === 0) return reply.status(404).send({ error: 'not found' });
      return reply.status(204).send();
    } catch (err) {
      app.log.error({ err }, '[alert-rules] delete failed');
      return reply.status(500).send({ error: 'internal error' });
    }
  });
}
