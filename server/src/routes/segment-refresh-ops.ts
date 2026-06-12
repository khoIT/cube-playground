/**
 * Segment-refresh cron monitor API.
 *
 *   GET  /api/segment-refresh/ops          — cron heartbeat + queue depth +
 *                                            per-segment derived health (wedged,
 *                                            degraded, serving-stale, …)
 *   POST /api/segment-refresh/:id/unstick  — operator override: reset one row
 *                                            from 'refreshing' → 'stale' so the
 *                                            next tick re-enqueues it (the manual
 *                                            twin of the wedge watchdog)
 *
 * Admin-gated to match its home (the sys-admin hub), mirroring preagg-runs.ts.
 * Read-only over segments + segment_card_cache except the unstick write, which
 * reuses the same single-id reconcile the watchdog runs.
 *
 * NOTE: per-instance by design — reports the gateway that served the request
 * (its own SQLite). The :3000 host tsx and :11000 docker gateways each have
 * their own DB + cron; see docs/query-paths-and-service-topology.md.
 */

import type { FastifyInstance } from 'fastify';
import { requireRole } from '../middleware/require-role.js';
import { requireFeature } from '../middleware/require-feature.js';
import { getDb } from '../db/sqlite.js';
import { getLastTickAt, TICK_INTERVAL_MS } from '../jobs/cron-runner.js';
import { isProcessing, queueSize, currentlyProcessing, pendingIds } from '../jobs/refresh-queue.js';
import { collectSegmentRefreshOps } from '../services/segment-refresh-ops.js';
import { collectSnapshotRuns } from '../services/segment-snapshot-runs.js';
import { reconcileSegmentRefreshing } from '../services/segment-status.js';
import { getCardProgress } from '../services/card-progress.js';

export default async function segmentRefreshOpsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireRole('admin'));
  app.addHook('preHandler', requireFeature('admin'));

  // ── GET /api/segment-refresh/ops ───────────────────────────────────────────
  app.get('/api/segment-refresh/ops', async () => {
    const lastTick = getLastTickAt();
    return collectSegmentRefreshOps({
      lastTickAt: lastTick != null ? new Date(lastTick).toISOString() : null,
      tickIntervalMs: TICK_INTERVAL_MS,
      queueProcessing: isProcessing(),
      queueSize: queueSize(),
      queueRunningId: currentlyProcessing(),
      queueQueuedIds: pendingIds(),
    });
  });

  // ── GET /api/segment-refresh/snapshot-runs ─────────────────────────────────
  // Nightly lakehouse membership-snapshot observability: per-instance heartbeat
  // log (this gateway's SQLite) + latest landed partition from shared Trino
  // (cross-instance truth, TTL-cached inside the service).
  app.get('/api/segment-refresh/snapshot-runs', async () => {
    return collectSnapshotRuns();
  });

  // ── GET /api/segment-refresh/:id/progress ──────────────────────────────────
  // Live per-card progress for the CURRENT (or most recent) card-runner pass of
  // one segment. Process-local + ephemeral (see card-progress.ts) — `progress`
  // is null when this gateway has never run a pass for the segment this boot.
  app.get<{ Params: { id: string } }>(
    '/api/segment-refresh/:id/progress',
    async (req) => {
      return { progress: getCardProgress(req.params.id) };
    },
  );

  // ── POST /api/segment-refresh/:id/unstick ──────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/api/segment-refresh/:id/unstick',
    async (req, reply) => {
      const { id } = req.params;
      const row = getDb()
        .prepare('SELECT status FROM segments WHERE id = ?')
        .get(id) as { status: string } | undefined;
      if (!row) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Segment not found' } });
      }
      const changed = reconcileSegmentRefreshing(id);
      // Idempotent: a non-refreshing row is already unstuck — report it as such
      // rather than erroring, so a double-click or a race doesn't 4xx.
      return reply.status(200).send({
        id,
        unstuck: changed,
        status: changed ? 'stale' : row.status,
      });
    },
  );
}
