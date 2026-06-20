/**
 * Segment-compare routes: overlap set-math + per-region metrics + save-region.
 *
 * Counts run as one set-op over the nightly membership snapshot in Trino (no
 * uids shipped to the app). save-region resolves a region's uid set server-side
 * and lands it as a manual segment — the 40k-uid list never round-trips through
 * the browser. Read access requires the caller to be able to read BOTH segments
 * (the same workspace/visibility guard the rest of the segments API uses), and
 * the pair must share a game (cross-game overlap is meaningless).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { guardSegment, type SegmentRow } from './segments.js';
import {
  computeSegmentOverlap,
  fetchRegionUids,
  type OverlapRegion,
} from '../lakehouse/segment-overlap-counts.js';
import {
  lakehouseConnectorFromEnv,
  lakehouseSchemaForGame,
  LAKEHOUSE_STATEMENT_TIMEOUT_MS,
} from '../lakehouse/lakehouse-trino-connector.js';
import { computeRegionMetrics } from '../services/segment-overlap-region-metrics.js';
import { createManualSegment } from '../services/create-manual-segment.js';
import { recordActivity } from '../services/activity-store.js';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const VALID_REGIONS: ReadonlySet<string> = new Set(['aOnly', 'both', 'bOnly']);

/** Trino emits snapshot_ts as 'YYYY-MM-DD HH:MM:SS[.fff]'; snapshot_date as a
 *  bare date. Read either as UTC and return ms, or null when unparseable. */
function snapshotMillis(ts: string | null, date: string | null): number | null {
  const raw = ts ?? (date ? `${date} 00:00:00` : null);
  if (!raw) return null;
  const ms = Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? ms : null;
}

function isStale(ms: number | null, now: number): boolean {
  return ms == null ? true : now - ms > STALE_AFTER_MS;
}

/** Load both segments with read-guard + same-game assertion. Sends the reply and
 *  returns null on any failure; returns the two rows on success. */
function loadPair(
  req: FastifyRequest,
  reply: FastifyReply,
  a: string | undefined,
  b: string | undefined,
): { a: SegmentRow; b: SegmentRow } | null {
  if (!a || !b) {
    reply.status(400).send({ error: { code: 'VALIDATION', message: 'a and b query params are required' } });
    return null;
  }
  if (a === b) {
    reply.status(400).send({ error: { code: 'VALIDATION', message: 'a and b must be different segments' } });
    return null;
  }
  const rowA = guardSegment(req, reply, a, 'read');
  if (!rowA) return null;
  const rowB = guardSegment(req, reply, b, 'read');
  if (!rowB) return null;
  if (rowA.game_id !== rowB.game_id) {
    reply.status(400).send({
      error: { code: 'CROSS_GAME', message: 'Segments belong to different games — overlap is undefined' },
    });
    return null;
  }
  return { a: rowA, b: rowB };
}

export default async function segmentCompareRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/segments/compare?a&b — overlap counts + sizes + staleness.
  app.get('/api/segments/compare', async (req, reply) => {
    const { a, b } = req.query as { a?: string; b?: string };
    const pair = loadPair(req, reply, a, b);
    if (!pair) return;

    const gameId = pair.a.game_id as string;
    const schema = lakehouseSchemaForGame(gameId);
    if (!schema) {
      return reply.status(422).send({
        error: { code: 'NO_SNAPSHOT_SCHEMA', message: `No lakehouse schema for game ${gameId}` },
      });
    }

    try {
      const counts = await computeSegmentOverlap(
        lakehouseConnectorFromEnv(),
        schema,
        { gameId, aSegId: pair.a.id as string, bSegId: pair.b.id as string },
        LAKEHOUSE_STATEMENT_TIMEOUT_MS,
      );
      const now = Date.now();
      const aMs = snapshotMillis(counts.aSnapshotTs, counts.aSnapshotDate);
      const bMs = snapshotMillis(counts.bSnapshotTs, counts.bSnapshotDate);
      return {
        a: { id: pair.a.id, name: pair.a.name, snapshot_ts: counts.aSnapshotTs, snapshot_date: counts.aSnapshotDate, stale: isStale(aMs, now), has_snapshot: aMs != null },
        b: { id: pair.b.id, name: pair.b.name, snapshot_ts: counts.bSnapshotTs, snapshot_date: counts.bSnapshotDate, stale: isStale(bMs, now), has_snapshot: bMs != null },
        game_id: gameId,
        a_size: counts.aSize,
        b_size: counts.bSize,
        a_only: counts.aOnly,
        both: counts.both,
        b_only: counts.bOnly,
        jaccard: counts.jaccard,
      };
    } catch (err) {
      req.log.error({ err }, 'segment overlap counts failed');
      return reply.status(502).send({
        error: { code: 'OVERLAP_QUERY_FAILED', message: (err as Error).message },
      });
    }
  });

  // GET /api/segments/compare/region-metrics?a&b&region — deferred metric table.
  app.get('/api/segments/compare/region-metrics', async (req, reply) => {
    const { a, b, region } = req.query as { a?: string; b?: string; region?: string };
    const pair = loadPair(req, reply, a, b);
    if (!pair) return;
    if (!region || !VALID_REGIONS.has(region)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'region must be aOnly | both | bOnly' } });
    }

    const gameId = pair.a.game_id as string;
    const schema = lakehouseSchemaForGame(gameId);
    if (!schema) {
      return reply.status(422).send({ error: { code: 'NO_SNAPSHOT_SCHEMA', message: `No lakehouse schema for game ${gameId}` } });
    }

    try {
      const uids = await fetchRegionUids(
        lakehouseConnectorFromEnv(),
        schema,
        { gameId, aSegId: pair.a.id as string, bSegId: pair.b.id as string, region: region as OverlapRegion },
        LAKEHOUSE_STATEMENT_TIMEOUT_MS,
      );
      const metrics = await computeRegionMetrics({
        gameId,
        cube: (pair.a.cube as string | null) ?? '',
        workspace: req.workspace.id,
        uids,
      });
      return { region, member_count: uids.length, metrics };
    } catch (err) {
      req.log.error({ err }, 'segment region metrics failed');
      return reply.status(502).send({ error: { code: 'REGION_METRICS_FAILED', message: (err as Error).message } });
    }
  });

  // POST /api/segments/compare/save-region — JOIN region uids → manual segment.
  app.post('/api/segments/compare/save-region', async (req, reply) => {
    const body = (req.body ?? {}) as { a?: string; b?: string; region?: string; name?: string };
    if (!body.a || !body.b || !body.region || !body.name) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'a, b, region, name are required' } });
    }
    if (!VALID_REGIONS.has(body.region)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'region must be aOnly | both | bOnly' } });
    }
    const pair = loadPair(req, reply, body.a, body.b);
    if (!pair) return;

    const gameId = pair.a.game_id as string;
    const schema = lakehouseSchemaForGame(gameId);
    if (!schema) {
      return reply.status(422).send({ error: { code: 'NO_SNAPSHOT_SCHEMA', message: `No lakehouse schema for game ${gameId}` } });
    }

    try {
      const uids = await fetchRegionUids(
        lakehouseConnectorFromEnv(),
        schema,
        { gameId, aSegId: pair.a.id as string, bSegId: pair.b.id as string, region: body.region as OverlapRegion },
        LAKEHOUSE_STATEMENT_TIMEOUT_MS,
      );
      if (uids.length === 0) {
        return reply.status(422).send({ error: { code: 'EMPTY_REGION', message: 'This region has no members to save' } });
      }
      const owner = req.owner;
      const ownerLabel = req.user?.username ?? req.user?.email ?? owner;
      const newId = createManualSegment({
        name: body.name,
        gameId,
        cube: (pair.a.cube as string | null) ?? null,
        uidList: uids,
        workspace: req.workspace.id,
        owner,
        ownerLabel,
      });
      recordActivity(req.principal, {
        eventType: 'segment_op',
        targetType: 'segment',
        targetId: newId,
        workspace: req.workspace.id,
        detail: { action: 'create' },
      });
      return reply.status(201).send({ id: newId, uid_count: uids.length });
    } catch (err) {
      req.log.error({ err }, 'segment save-region failed');
      return reply.status(502).send({ error: { code: 'SAVE_REGION_FAILED', message: (err as Error).message } });
    }
  });
}
