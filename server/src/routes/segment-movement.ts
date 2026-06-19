/**
 * Segment movement + KPI trend + state-distribution read routes.
 *
 * All endpoints are read-only, access-controlled via guardSegment, and served
 * stale on Trino error (last-good TTL cache per endpoint+params). The
 * `granularity` param triggers server-side downsampling via downsample-snapshots
 * (last-in-bucket, never sum) so mixed-cadence windows are handled correctly.
 *
 * Redaction parity with the members API: sensitive monetization/VIP column
 * values are removed from unauthenticated callers in the state-distribution
 * endpoints. Parity reference: segments.ts:589 uses `Boolean(req.user)` as the
 * authenticated signal — we do the same here.
 */

import type { FastifyInstance } from 'fastify';
import { guardSegment } from './segments.js';
import {
  readKpiTrend,
  readMovementSeries,
  readStateDistribution,
  readStateDistributionTrend,
  readCadenceHistory,
  readCaptureTimestamps,
  clampMovementDays,
  MAX_DAILY_DAYS,
  MAX_SUBDAILY_DAYS,
  SNAPSHOT_TS_RE,
  DATE_RE,
} from '../lakehouse/segment-movement-reader.js';
import {
  downsample,
  floorTsBucket,
  computeCaptureEras,
  finestEraCadence,
  type SnapshotPoint,
  type SnapshotCadence,
  type CaptureEra,
} from '../lakehouse/downsample-snapshots.js';
import { STATE_VALUE_COLUMNS } from '../lakehouse/canonical-metric-set.js';
import { isSnapshotCadence } from '../services/snapshot-cadence.js';

/** Sub-daily granularities that trigger the tighter 14-day range cap. */
const SUBDAILY_GRANULARITIES: ReadonlySet<SnapshotCadence> = new Set([
  '15m', '1h', '3h', '6h', '12h',
]);

/** Allow-listed dimension keys for state-distribution endpoints. Only canonical
 *  state column keys are accepted — arbitrary column names would be SQL injection. */
const ALLOWED_DIMENSIONS: ReadonlySet<string> = new Set(
  STATE_VALUE_COLUMNS.map((c) => c.key),
);

/** Sensitive dimension keys — redacted from unauthenticated callers.
 *  Parity with redactSensitiveMembers() in segments.ts. */
const SENSITIVE_DIMENSIONS: ReadonlySet<string> = new Set([
  'ltv_vnd', 'ltv_30d_vnd', 'payer_tier', 'is_paying_user', 'is_paying_30d',
]);

const CACHE_TTL_MS = 10 * 60_000; // 10 min — movement data is snapshot-cadence-fresh

// Bounded insertion-order eviction cache keyed by (segment:endpoint:params).
const MAX_CACHE = 1000;
const cache = new Map<string, { at: number; payload: unknown }>();

function cacheGet(key: string): unknown | null {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) return null;
  return hit.payload;
}

function cacheSet(key: string, payload: unknown): void {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), payload });
}

/** Test hook */
export function __clearMovementCache(): void {
  cache.clear();
}

/**
 * Parse and validate from/to date range.
 * Returns `{ fromDate, toDate, days }` on success, or `{ error }` on validation failure.
 * Callers MUST check for `error` and return 400 immediately — do NOT fall back to
 * defaults on malformed input (silently defaulting would mask injection probing,
 * and the raw values are interpolated into Trino DATE literals downstream).
 *
 * Enforces:
 *  - strict DATE regex on explicit from/to values → reject on mismatch
 *  - the span cap applies to explicit from/to too, not only the default derivation
 *    (the days-clamp only bounds the default window; explicit dates bypass it)
 */
type DateRangeResult =
  | { ok: true; fromDate: string; toDate: string; days: number }
  | { ok: false; error: string };

function parseDateRange(
  query: Record<string, string | undefined>,
  granularity: SnapshotCadence | null,
): DateRangeResult {
  const subdaily = granularity !== null && SUBDAILY_GRANULARITIES.has(granularity);
  const maxDays = subdaily ? MAX_SUBDAILY_DAYS : MAX_DAILY_DAYS;

  // Validate explicit `to` param — reject malformed, never silently fall back
  // (the value is interpolated into a Trino DATE literal downstream).
  if (query.to !== undefined && !DATE_RE.test(query.to)) {
    return { ok: false, error: `invalid 'to' date: must be YYYY-MM-DD` };
  }
  // Validate explicit `from` param.
  if (query.from !== undefined && !DATE_RE.test(query.from)) {
    return { ok: false, error: `invalid 'from' date: must be YYYY-MM-DD` };
  }

  const days = clampMovementDays(query.days, subdaily);
  const toDate = query.to ?? new Date().toISOString().slice(0, 10);
  const fromDate =
    query.from ??
    new Date(Date.parse(toDate) - (days - 1) * 86_400_000).toISOString().slice(0, 10);

  // Enforce the span cap on explicit from/to. The `days`-based clamping above only
  // governs the default derivation; explicit dates bypass it and must be checked here.
  if (query.from !== undefined || query.to !== undefined) {
    const spanDays = Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000) + 1;
    if (spanDays > maxDays) {
      return { ok: false, error: `date range exceeds maximum ${maxDays} days for ${subdaily ? 'sub-daily' : 'daily'} granularity` };
    }
  }

  return { ok: true, fromDate, toDate, days };
}

function parseGranularity(query: Record<string, string | undefined>): SnapshotCadence | null {
  const g = query.granularity;
  if (!g) return null;
  return isSnapshotCadence(g) ? g : null;
}

/**
 * Derive the honest capture timeline for the coverage strip: the per-era
 * finest-observed cadence plus the finest grain captured anywhere in the
 * window. Built from the KPI table's distinct snapshot_ts (the authoritative,
 * full-history capture record); falls back to whatever ts the calling endpoint
 * already has when the KPI source is empty. Independent of the requested view
 * granularity — the strip must reflect what was captured, not how it is
 * currently being downsampled for display.
 */
function captureTimeline(
  captureTs: string[],
  fallbackTs: string[],
): { captureEras: CaptureEra[]; finestGranularity: SnapshotCadence } {
  const ts = captureTs.length > 0 ? captureTs : fallbackTs;
  const captureEras = computeCaptureEras(ts);
  return {
    captureEras,
    finestGranularity: finestEraCadence(captureEras),
  };
}

export default async function segmentMovementRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/segments/:id/kpi-trend
   * Query: ?metrics=m1,m2&granularity=1h&from=YYYY-MM-DD&to=YYYY-MM-DD&days=N
   *
   * Returns KPI time-series for a segment. `metrics` filters to specific
   * metric_ids (comma-separated); omit for all. `granularity` downsamples via
   * last-in-bucket so mixed-cadence windows collapse coherently.
   */
  app.get('/api/segments/:id/kpi-trend', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = guardSegment(req, reply, id, 'read');
    if (!row) return reply;
    const gameId = typeof row.game_id === 'string' ? row.game_id : null;
    if (!gameId) {
      return reply.status(404).send({ error: { code: 'NO_GAME', message: 'Segment has no game_id' } });
    }

    const q = req.query as Record<string, string | undefined>;
    const granularity = parseGranularity(q);
    const range = parseDateRange(q, granularity);
    if (!range.ok) {
      return reply.status(400).send({ error: { code: 'INVALID_DATE_RANGE', message: range.error } });
    }
    const { fromDate, toDate } = range;
    const metrics = q.metrics ? q.metrics.split(',').map((m) => m.trim()).filter(Boolean) : undefined;

    const cacheKey = `kpi-trend:${id}:${fromDate}:${toDate}:${metrics?.join(',')}:${granularity}`;
    const hit = cacheGet(cacheKey);
    if (hit) return hit;

    try {
      const rows = await readKpiTrend(gameId, id, fromDate, toDate, { metrics });
      const cadenceDefs = await readCadenceHistory(gameId, id, fromDate, toDate);

      // Group by metric_id → array of SnapshotPoints.
      const byMetric = new Map<string, SnapshotPoint[]>();
      for (const r of rows) {
        const pts = byMetric.get(r.metricId) ?? [];
        pts.push({ ts: r.ts, value: r.value, memberCount: r.memberCount });
        byMetric.set(r.metricId, pts);
      }

      const series: Array<{ metricId: string; points: SnapshotPoint[]; carryForward: string[] }> = [];
      for (const [metricId, pts] of byMetric) {
        if (granularity) {
          const ds = downsample(pts, granularity, cadenceDefs);
          series.push({
            metricId,
            points: ds.points,
            carryForward: [...ds.carryForwardBuckets],
          });
        } else {
          series.push({ metricId, points: pts, carryForward: [] });
        }
      }

      // Compute effective_granularity + cadence_changes from all points.
      const allTs = rows.map((r) => r.ts);
      const { effectiveGranularity, cadenceChanges } = downsample(
        allTs.map((ts) => ({ ts })),
        granularity ?? 'daily',
        cadenceDefs,
      );
      // allTs comes from the KPI table already, so its distinct set IS the
      // authoritative capture record — no extra query needed for this endpoint.
      const { captureEras, finestGranularity } = captureTimeline([...new Set(allTs)], allTs);

      const payload = {
        segmentId: id,
        gameId,
        fromDate,
        toDate,
        granularity,
        series,
        effectiveGranularity,
        finestGranularity,
        cadenceChanges,
        captureEras,
        asOf: rows.length > 0 ? rows[rows.length - 1].ts : null,
      };
      cacheSet(cacheKey, payload);
      return payload;
    } catch (err) {
      const stale = cacheGet(cacheKey + ':stale');
      if (stale) return { ...(stale as Record<string, unknown>), stale: true };
      return reply.status(502).send({
        error: { code: 'LAKEHOUSE_UNAVAILABLE', message: (err as Error).message },
      });
    }
  });

  /**
   * GET /api/segments/:id/movement
   * Query: ?granularity=1h&from=YYYY-MM-DD&to=YYYY-MM-DD&days=N
   *
   * Returns entered/exited + member_count series. Downsampled if granularity given.
   */
  app.get('/api/segments/:id/movement', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = guardSegment(req, reply, id, 'read');
    if (!row) return reply;
    const gameId = typeof row.game_id === 'string' ? row.game_id : null;
    if (!gameId) {
      return reply.status(404).send({ error: { code: 'NO_GAME', message: 'Segment has no game_id' } });
    }

    const q = req.query as Record<string, string | undefined>;
    const granularity = parseGranularity(q);
    const range = parseDateRange(q, granularity);
    if (!range.ok) {
      return reply.status(400).send({ error: { code: 'INVALID_DATE_RANGE', message: range.error } });
    }
    const { fromDate, toDate } = range;
    const cacheKey = `movement:${id}:${fromDate}:${toDate}:${granularity}`;
    const hit = cacheGet(cacheKey);
    if (hit) return hit;

    try {
      const rows = await readMovementSeries(gameId, id, fromDate, toDate);
      const cadenceDefs = await readCadenceHistory(gameId, id, fromDate, toDate);

      let points: SnapshotPoint[] = rows.map((r) => ({
        ts: r.ts,
        entered: r.entered,
        exited: r.exited,
        memberCount: r.memberCount,
      }));
      let carryForward: string[] = [];
      let effectiveGranularity: SnapshotCadence = 'daily';
      let cadenceChanges = cadenceDefs.length > 0
        ? downsample(points, granularity ?? 'daily', cadenceDefs).cadenceChanges
        : [];

      if (granularity && points.length > 0) {
        const ds = downsample(points, granularity, cadenceDefs);
        points = ds.points;
        carryForward = [...ds.carryForwardBuckets];
        effectiveGranularity = ds.effectiveGranularity;
        cadenceChanges = ds.cadenceChanges;
      } else if (points.length > 0) {
        const ds = downsample(points, 'daily', cadenceDefs);
        effectiveGranularity = ds.effectiveGranularity;
      }

      // Movement rows come from the (sparse) delta table; source the coverage
      // timeline from the KPI table's full capture record instead.
      const captureTs = await readCaptureTimestamps(gameId, id, fromDate, toDate);
      const { captureEras, finestGranularity } = captureTimeline(
        captureTs,
        rows.map((r) => r.ts),
      );

      const payload = {
        segmentId: id,
        gameId,
        fromDate,
        toDate,
        granularity,
        points,
        carryForward,
        effectiveGranularity,
        finestGranularity,
        cadenceChanges,
        captureEras,
        asOf: points.length > 0 ? points[points.length - 1].ts : null,
      };
      cacheSet(cacheKey, payload);
      return payload;
    } catch (err) {
      const stale = cacheGet(cacheKey + ':stale');
      if (stale) return { ...(stale as Record<string, unknown>), stale: true };
      return reply.status(502).send({
        error: { code: 'LAKEHOUSE_UNAVAILABLE', message: (err as Error).message },
      });
    }
  });

  /**
   * GET /api/segments/:id/state-distribution
   * Query: ?ts=YYYY-MM-DD HH:MM:00&dimension=lifecycle_stage
   *
   * Bucket counts for a categorical dimension at a single snapshot_ts.
   * Dimension must be in the canonical state column allow-list.
   */
  app.get('/api/segments/:id/state-distribution', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = guardSegment(req, reply, id, 'read');
    if (!row) return reply;
    const gameId = typeof row.game_id === 'string' ? row.game_id : null;
    if (!gameId) {
      return reply.status(404).send({ error: { code: 'NO_GAME', message: 'Segment has no game_id' } });
    }

    const q = req.query as Record<string, string | undefined>;
    const dimension = q.dimension;
    const snapshotTs = q.ts;

    if (!dimension || !ALLOWED_DIMENSIONS.has(dimension)) {
      return reply.status(400).send({
        error: { code: 'INVALID_DIMENSION', message: `dimension must be one of: ${[...ALLOWED_DIMENSIONS].join(', ')}` },
      });
    }
    if (!snapshotTs) {
      return reply.status(400).send({ error: { code: 'MISSING_TS', message: 'ts param required' } });
    }
    // Validate ts format — it is interpolated into a Trino TIMESTAMP literal, so a
    // malformed value would otherwise be an injection vector.
    if (!SNAPSHOT_TS_RE.test(snapshotTs)) {
      return reply.status(400).send({ error: { code: 'INVALID_TS', message: 'ts must be YYYY-MM-DD or YYYY-MM-DD HH:MM:SS' } });
    }

    // Gate redaction on req.user, NOT req.principal: principal is populated for ALL
    // callers (anonymous requests carry a default sub), so it can't distinguish a
    // tokenless caller. req.user is set only when a real token verified. Mirrors the
    // tokenless members-pull, which redacts on Boolean(req.user).
    const authenticated = Boolean(req.user);
    const cacheKey = `state-dist:${id}:${snapshotTs}:${dimension}:${authenticated}`;
    const hit = cacheGet(cacheKey);
    if (hit) return hit;

    try {
      let rows = await readStateDistribution(gameId, id, snapshotTs, dimension);

      // Redact sensitive dimensions for unauthenticated callers.
      if (!authenticated && SENSITIVE_DIMENSIONS.has(dimension)) {
        rows = [];
      }

      const payload = {
        segmentId: id,
        gameId,
        snapshotTs,
        dimension,
        rows,
        redacted: !authenticated && SENSITIVE_DIMENSIONS.has(dimension),
      };
      cacheSet(cacheKey, payload);
      return payload;
    } catch (err) {
      const stale = cacheGet(cacheKey + ':stale');
      if (stale) return { ...(stale as Record<string, unknown>), stale: true };
      return reply.status(502).send({
        error: { code: 'LAKEHOUSE_UNAVAILABLE', message: (err as Error).message },
      });
    }
  });

  /**
   * GET /api/segments/:id/state-distribution-trend
   * Query: ?dimension=lifecycle_stage&granularity=1h&from=YYYY-MM-DD&to=YYYY-MM-DD&days=N
   *
   * Stacked distribution over time. Same redaction + granularity rules as above.
   */
  app.get('/api/segments/:id/state-distribution-trend', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = guardSegment(req, reply, id, 'read');
    if (!row) return reply;
    const gameId = typeof row.game_id === 'string' ? row.game_id : null;
    if (!gameId) {
      return reply.status(404).send({ error: { code: 'NO_GAME', message: 'Segment has no game_id' } });
    }

    const q = req.query as Record<string, string | undefined>;
    const dimension = q.dimension;
    const granularity = parseGranularity(q);
    const range = parseDateRange(q, granularity);
    if (!range.ok) {
      return reply.status(400).send({ error: { code: 'INVALID_DATE_RANGE', message: range.error } });
    }
    const { fromDate, toDate } = range;

    if (!dimension || !ALLOWED_DIMENSIONS.has(dimension)) {
      return reply.status(400).send({
        error: { code: 'INVALID_DIMENSION', message: `dimension must be one of: ${[...ALLOWED_DIMENSIONS].join(', ')}` },
      });
    }

    // Gate on req.user, not req.principal (see state-distribution above).
    const authenticated = Boolean(req.user);
    const cacheKey = `state-dist-trend:${id}:${fromDate}:${toDate}:${dimension}:${granularity}:${authenticated}`;
    const hit = cacheGet(cacheKey);
    if (hit) return hit;

    // Redaction early-exit — return the SAME shape as the success path (rows:[]) so
    // the client renders an empty-but-valid series rather than mishandling a variant shape.
    if (!authenticated && SENSITIVE_DIMENSIONS.has(dimension)) {
      const payload = {
        segmentId: id, gameId, fromDate, toDate, dimension, granularity,
        rows: [], effectiveGranularity: 'daily' as SnapshotCadence,
        finestGranularity: 'daily' as SnapshotCadence,
        carryForward: [], cadenceChanges: [], captureEras: [] as CaptureEra[],
        asOf: null, redacted: true,
      };
      return payload;
    }

    try {
      const rows = await readStateDistributionTrend(gameId, id, fromDate, toDate, dimension);
      const cadenceDefs = await readCadenceHistory(gameId, id, fromDate, toDate);

      // Build per-(ts, dim_val) points, then downsample if requested.
      // Group by ts first, collect dim→count entries per ts.
      type TsEntry = { ts: string; [dim: string]: unknown };
      const tsMap = new Map<string, TsEntry>();
      for (const r of rows) {
        const entry = tsMap.get(r.ts) ?? { ts: r.ts };
        entry[r.dimension] = r.count;
        tsMap.set(r.ts, entry);
      }
      let points: SnapshotPoint[] = [...tsMap.values()].sort((a, b) =>
        a.ts.localeCompare(b.ts),
      );

      let carryForward: string[] = [];
      let effectiveGranularity: SnapshotCadence = 'daily';
      let cadenceChanges = cadenceDefs.length > 0
        ? downsample(points, granularity ?? 'daily', cadenceDefs).cadenceChanges
        : [];

      if (granularity && points.length > 0) {
        // For stacked distributions, last-in-bucket = the most recent snapshot
        // in that bucket (correctly picks up mid-bucket changes).
        const bucketMap = new Map<string, SnapshotPoint>();
        for (const p of points) {
          bucketMap.set(floorTsBucket(p.ts, granularity), { ...p, ts: floorTsBucket(p.ts, granularity) });
        }
        const ds = downsample(points, granularity, cadenceDefs);
        points = [...bucketMap.values()].sort((a, b) => a.ts.localeCompare(b.ts));
        carryForward = [...ds.carryForwardBuckets];
        effectiveGranularity = ds.effectiveGranularity;
        cadenceChanges = ds.cadenceChanges;
      } else if (points.length > 0) {
        effectiveGranularity = downsample(points, 'daily', cadenceDefs).effectiveGranularity;
      }

      // State rows are absent for empty-cohort snapshots; source the coverage
      // timeline from the KPI table's full capture record instead.
      const captureTs = await readCaptureTimestamps(gameId, id, fromDate, toDate);
      const { captureEras, finestGranularity } = captureTimeline(
        captureTs,
        rows.map((r) => r.ts),
      );

      const payload = {
        segmentId: id,
        gameId,
        fromDate,
        toDate,
        dimension,
        granularity,
        rows: points,
        carryForward,
        effectiveGranularity,
        finestGranularity,
        cadenceChanges,
        captureEras,
        asOf: points.length > 0 ? points[points.length - 1].ts : null,
        redacted: false,
      };
      cacheSet(cacheKey, payload);
      return payload;
    } catch (err) {
      const stale = cacheGet(cacheKey + ':stale');
      if (stale) return { ...(stale as Record<string, unknown>), stale: true };
      return reply.status(502).send({
        error: { code: 'LAKEHOUSE_UNAVAILABLE', message: (err as Error).message },
      });
    }
  });
}
