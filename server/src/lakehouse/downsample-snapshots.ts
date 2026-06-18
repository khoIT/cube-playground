/**
 * View-time downsampling of snapshot time-series.
 *
 * Snapshot points are as-of values (gauges or running cumulative totals), NOT
 * deltas. The correct downsample for both kinds is LAST-IN-BUCKET (close):
 *  - Gauge (member_count, ltv_total, paying_rate): the last value in the bucket
 *    is the as-of reading for that period.
 *  - Today-so-far accumulator (revenue, txns): each snapshot is already a
 *    cumulative-from-midnight value; the last snapshot in the bucket is the
 *    final cumulative for that bucket. Never sum across snapshots.
 *
 * All functions in this module are PURE (no I/O, no side effects) so they are
 * trivially unit-testable without any database or Trino dependency.
 */

import {
  SNAPSHOT_CADENCES,
  CADENCE_MS,
  floorToCadenceBucket,
  type SnapshotCadence,
} from '../services/snapshot-cadence.js';

export type { SnapshotCadence };

/** A single snapshot point as returned by the reader. */
export interface SnapshotPoint {
  /** Canonical 'YYYY-MM-DD HH:MM:00' snapshot_ts string. */
  ts: string;
  [key: string]: unknown;
}

/** A named series of snapshot points (e.g. one metric, or entered/exited). */
export interface SnapshotSeries {
  key: string;
  points: SnapshotPoint[];
}

/** Cadence change event: the snapshot_cadence column changed between two
 *  consecutive definition rows, from `from` to `to` at timestamp `ts`. */
export interface CadenceChange {
  ts: string;
  from: SnapshotCadence;
  to: SnapshotCadence;
}

/** Result of downsampling one or more series to a target granularity. */
export interface DownsampleResult {
  /** Downsampled points; ts is floored to target bucket. */
  points: SnapshotPoint[];
  /**
   * Coarsest cadence present in the input window — the finest granularity the
   * UI should allow without implying missing detail. For example, if the window
   * contains both 15m and daily points, effective_granularity is 'daily'
   * (the coarsest present).
   */
  effectiveGranularity: SnapshotCadence;
  /**
   * Buckets where the requested granularity is FINER than the actual captured
   * cadence. Points in those buckets are carry-forwards (the most recent prior
   * capture), not new observations. The UI should render these as steps.
   */
  carryForwardBuckets: Set<string>;
  /** Cadence-change events detected from consecutive definition rows. */
  cadenceChanges: CadenceChange[];
}

/**
 * Floor a snapshot_ts string to a target granularity bucket. Returns a
 * 'YYYY-MM-DD HH:MM:00' string (same format as snapshot_ts).
 *
 * Delegated to floorToCadenceBucket by converting the ts string to a ms
 * epoch, so the same bucket math applies.
 */
export function floorTsBucket(ts: string, granularity: SnapshotCadence): string {
  // Parse 'YYYY-MM-DD HH:MM:00' as UTC (our snapshot_ts values are stored as
  // GMT+7 wall-clock tz-naive strings; treating them as UTC here is consistent
  // because floorToCadenceBucket also adds TZ_OFFSET_MS, so the bucket floor
  // is relative to the same offset). We subtract TZ_OFFSET_MS before passing
  // so that adding it back inside floorToCadenceBucket yields the original ts.
  const TZ_OFFSET_MS = 7 * 3_600_000;
  const ms = Date.parse(ts.replace(' ', 'T') + 'Z') - TZ_OFFSET_MS;
  if (!Number.isFinite(ms)) return ts; // malformed — pass through unchanged
  return floorToCadenceBucket(ms, granularity);
}

/**
 * Infer the approximate cadence of a snapshot_ts string based on its
 * minute/hour component. Used to decide effective_granularity.
 *
 * Order matters: check finest-grained first so e.g. 09:15 → 15m, not 3h.
 * Hour-level cadences are detected only when minute == 0 AND the hour is
 * a non-zero multiple of the cadence width (1, 3, 6, 12). Hour 0 is daily
 * (the cadence that always floors to midnight).
 */
function inferCadence(ts: string): SnapshotCadence {
  const minute = parseInt(ts.slice(14, 16), 10);
  const hour = parseInt(ts.slice(11, 13), 10);

  // Non-zero minute → sub-hourly (our only sub-hourly cadence is 15m).
  if (minute !== 0) return '15m';

  // Minute == 0 from here.
  if (hour === 0) return 'daily'; // midnight → daily bucket
  // Finest-first among hour-aligned cadences to avoid 3h matching 6h/12h.
  if (hour % 12 === 0) return '12h';
  if (hour % 6 === 0) return '6h';
  if (hour % 3 === 0) return '3h';
  return '1h'; // non-zero, non-multiple-of-3 hour
}

/**
 * Coarsest cadence among a list of snapshot_ts strings. The coarsest cadence
 * is the one with the LARGEST bucket width (daily > 12h > 6h > 3h > 1h > 15m).
 * Used to compute effective_granularity for a window.
 */
export function coarsestCadence(tsList: string[]): SnapshotCadence {
  let coarsestMs = 0;
  let coarsest: SnapshotCadence = '15m';
  for (const ts of tsList) {
    const c = inferCadence(ts);
    if (CADENCE_MS[c] > coarsestMs) {
      coarsestMs = CADENCE_MS[c];
      coarsest = c;
    }
  }
  return coarsest;
}

/**
 * Detect cadence changes from a sequence of (ts, cadence) definition rows
 * ordered by ts ascending. A change is recorded when the cadence field differs
 * from the prior row. Rows with missing/unknown cadence are treated as 'daily'.
 */
export function detectCadenceChanges(
  rows: Array<{ ts: string; cadence: string | null | undefined }>,
): CadenceChange[] {
  const changes: CadenceChange[] = [];
  let prev: SnapshotCadence | null = null;
  for (const row of rows) {
    const cur = isSnapshotCadence(row.cadence) ? row.cadence : 'daily';
    if (prev !== null && cur !== prev) {
      changes.push({ ts: row.ts, from: prev, to: cur });
    }
    prev = cur;
  }
  return changes;
}

function isSnapshotCadence(v: unknown): v is SnapshotCadence {
  return typeof v === 'string' && (SNAPSHOT_CADENCES as readonly string[]).includes(v);
}

/**
 * Downsample an array of snapshot points to a target granularity.
 *
 * Algorithm: floor each point's ts to the target bucket, group by bucket,
 * keep the LAST point in each bucket (by original ts sort order). The input
 * must be sorted ascending by ts.
 *
 * When the requested granularity is finer than the actual cadence for a bucket
 * (e.g. requesting 1h but the point was captured daily), the bucket is flagged
 * as a carry-forward — it represents the prior captured value, not a new
 * observation. No synthetic interpolated points are added.
 *
 * @param points  Input points sorted ascending by ts.
 * @param granularity  Target bucket granularity.
 * @param cadenceChanges  Optional cadence-change events for carry-forward detection.
 */
export function downsamplePoints(
  points: SnapshotPoint[],
  granularity: SnapshotCadence,
  cadenceChanges: CadenceChange[] = [],
): Pick<DownsampleResult, 'points' | 'carryForwardBuckets'> {
  if (points.length === 0) {
    return { points: [], carryForwardBuckets: new Set() };
  }

  // Group by target bucket, keeping last-in-bucket.
  const bucketMap = new Map<string, SnapshotPoint>();
  for (const p of points) {
    const bucket = floorTsBucket(p.ts, granularity);
    // Last-in-bucket wins (input is ascending, so later iterations overwrite).
    bucketMap.set(bucket, { ...p, ts: bucket });
  }

  const outputPoints = [...bucketMap.values()].sort((a, b) => a.ts.localeCompare(b.ts));

  // Identify carry-forward buckets: buckets whose granularity (target) is
  // FINER than the cadence of the captured point(s) in that bucket.
  // We detect this by comparing the target bucket width to the cadence-change
  // history: any bucket in a period where the segment was captured at a coarser
  // cadence than the requested granularity is a carry-forward.
  const carryForwardBuckets = new Set<string>();
  const targetMs = CADENCE_MS[granularity];

  // Build a timeline of cadence intervals from cadence changes.
  // Between consecutive change events, the cadence is constant.
  if (cadenceChanges.length > 0) {
    for (const bucket of outputPoints) {
      // Find the active cadence at this bucket's ts.
      let activeCadence: SnapshotCadence = 'daily'; // default before any change
      for (const change of cadenceChanges) {
        if (change.ts <= bucket.ts) activeCadence = change.to;
        else break;
      }
      if (CADENCE_MS[activeCadence] > targetMs) {
        carryForwardBuckets.add(bucket.ts);
      }
    }
  }

  return { points: outputPoints, carryForwardBuckets };
}

/**
 * Full downsample pipeline for a flat array of snapshot points.
 *
 * Returns the downsampled points, effective_granularity (coarsest cadence
 * present in the input), carry-forward bucket flags, and cadence-change events.
 *
 * When granularity === the effective cadence, the points are returned as-is
 * (no further collapsing needed).
 */
export function downsample(
  points: SnapshotPoint[],
  granularity: SnapshotCadence,
  cadenceDefRows: Array<{ ts: string; cadence: string | null | undefined }> = [],
): DownsampleResult {
  const effectiveGranularity = coarsestCadence(points.map((p) => p.ts));
  const cadenceChanges = detectCadenceChanges(cadenceDefRows);
  const { points: downsampled, carryForwardBuckets } = downsamplePoints(
    points,
    granularity,
    cadenceChanges,
  );
  return { points: downsampled, effectiveGranularity, carryForwardBuckets, cadenceChanges };
}
