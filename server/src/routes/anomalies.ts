/**
 * Anomaly REST endpoints (Phase 2).
 *
 *   GET  /api/anomalies?game=<id>&status=<open|ack|snoozed>
 *   POST /api/anomalies/:id/ack
 *   POST /api/anomalies/:id/snooze   body: { until: ISO8601 }
 *
 * Input is validated at the boundary; malformed requests return 400.
 * The old GET /api/anomaly-state is kept as a deprecation shim in anomaly-state.ts.
 */

import type { FastifyInstance } from 'fastify';
import {
  listAnomalies,
  setAnomalyStatus,
  type AnomalyRow,
} from '../services/anomaly-state-store.js';

const VALID_STATUSES = new Set(['open', 'ack', 'snoozed']);

export default async function anomaliesRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/anomalies?game=<id>&status=open
  app.get('/api/anomalies', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const game = q.game?.trim();
    if (!game) {
      return reply.status(400).send({ error: '`game` query param required' });
    }
    const status = q.status?.trim() ?? 'open';
    if (!VALID_STATUSES.has(status)) {
      return reply.status(400).send({ error: '`status` must be open|ack|snoozed' });
    }

    let rows: AnomalyRow[];
    try {
      rows = listAnomalies(game, status);
    } catch (err) {
      app.log.error({ err }, '[anomalies] listAnomalies failed');
      return reply.status(500).send({ error: 'internal error' });
    }
    return { anomalies: rows, game, status };
  });

  // POST /api/anomalies/:id/ack
  app.post('/api/anomalies/:id/ack', async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    if (id === null) {
      return reply.status(400).send({ error: 'invalid anomaly id' });
    }
    try {
      setAnomalyStatus(id, 'ack');
    } catch (err) {
      app.log.error({ err }, '[anomalies] ack failed');
      return reply.status(500).send({ error: 'internal error' });
    }
    return { ok: true, id, status: 'ack' };
  });

  // POST /api/anomalies/:id/snooze   body: { until: ISO8601 }
  app.post('/api/anomalies/:id/snooze', async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    if (id === null) {
      return reply.status(400).send({ error: 'invalid anomaly id' });
    }
    const body = req.body as Record<string, unknown> | null | undefined;
    const until = typeof body?.until === 'string' ? body.until.trim() : '';
    if (!until || isNaN(Date.parse(until))) {
      return reply.status(400).send({ error: '`until` must be a valid ISO8601 string' });
    }
    try {
      setAnomalyStatus(id, 'snoozed', until);
    } catch (err) {
      app.log.error({ err }, '[anomalies] snooze failed');
      return reply.status(500).send({ error: 'internal error' });
    }
    return { ok: true, id, status: 'snoozed', snooze_until: until };
  });
}

function parseId(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
