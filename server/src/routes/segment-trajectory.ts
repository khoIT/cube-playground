/**
 * Segment trajectory route — GET /api/segments/:id/trajectory?days=90
 *
 * Cohort size over time + entered/exited bars, read from the lakehouse
 * membership snapshot (NOT SQLite segment_refresh_log — that sparse,
 * refresh-cadence path stays as the fallback for segments without snapshots).
 *
 * Daily data → in-memory TTL cache per (segment, days); a repeat view within
 * the TTL issues zero Trino queries. Access goes through guardSegment so
 * workspace + visibility rules match every other segment read.
 */

import type { FastifyInstance } from 'fastify';
import { guardSegment } from './segments.js';
import {
  readSizeSeries,
  readDeltaSeries,
  clampTrajectoryDays,
  type SizePoint,
  type DeltaPoint,
} from '../lakehouse/segment-trajectory-reader.js';

const CACHE_TTL_MS = 60 * 60_000; // 1h — snapshots move once per day

export interface TrajectoryPayload {
  segmentId: string;
  gameId: string;
  days: number;
  size: SizePoint[];
  delta: DeltaPoint[];
  /** True when no partitions exist yet for this segment. */
  empty: boolean;
}

// Bounded with insertion-order eviction — keys are (segment, days) so growth
// is slow, but unbounded maps in long-lived processes are a leak by default.
const MAX_CACHE_ENTRIES = 500;
const cache = new Map<string, { at: number; payload: TrajectoryPayload }>();

/** Test hook — clears the route cache. */
export function __clearTrajectoryCache(): void {
  cache.clear();
}

export default async function segmentTrajectoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/segments/:id/trajectory', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = guardSegment(req, reply, id, 'read');
    if (!row) return reply;

    const gameId = typeof row.game_id === 'string' ? row.game_id : null;
    if (row.type !== 'predicate' || !gameId) {
      return reply.status(404).send({
        error: { code: 'NO_TRAJECTORY', message: 'Trajectory exists only for predicate segments with a game' },
      });
    }

    const days = clampTrajectoryDays((req.query as Record<string, string | undefined>).days);
    const key = `${id}:${days}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload;

    try {
      // Serial, not parallel — lakehouse reads share one Trino; two cheap
      // aggregates back-to-back beat doubling concurrent load on cold starts.
      const size = await readSizeSeries(gameId, id, days);
      const delta = await readDeltaSeries(gameId, id, days);
      const payload: TrajectoryPayload = {
        segmentId: id,
        gameId,
        days,
        size,
        delta,
        empty: size.length === 0,
      };
      if (cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, { at: Date.now(), payload });
      return payload;
    } catch (err) {
      return reply.status(502).send({
        error: { code: 'LAKEHOUSE_UNAVAILABLE', message: (err as Error).message },
      });
    }
  });
}
