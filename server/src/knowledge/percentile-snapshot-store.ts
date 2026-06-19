/**
 * Internal benchmark store: portfolio percentile bands per metric.
 *
 * A "benchmark" answers "what is normal?" two ways — an external industry norm
 * (hand-authored in the lever library) and an INTERNAL band derived from the
 * portfolio's own distribution. This store holds the internal side: for each
 * tracked metric, the p25/p50/p75/p90 of that metric's value ACROSS all live
 * games (one trailing-30d value per game → percentiles across the game set).
 *
 * Keyed by metric_key alone — the band is the portfolio distribution, the same
 * reference regardless of which game is asking. The nightly job upserts it;
 * the benchmark resolver reads it.
 */

import { getDb } from '../db/sqlite.js';

export interface PercentileBands {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface PercentileSnapshotRow extends PercentileBands {
  metricKey: string;
  /** How many games contributed values to this percentile computation. */
  sampleN: number;
  /** ISO timestamp of the computation. */
  computedAt: string;
}

interface RawRow {
  metric_key: string;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  sample_n: number;
  computed_at: string;
}

function toRow(r: RawRow): PercentileSnapshotRow {
  return {
    metricKey: r.metric_key,
    p25: r.p25,
    p50: r.p50,
    p75: r.p75,
    p90: r.p90,
    sampleN: r.sample_n,
    computedAt: r.computed_at,
  };
}

/** Read the portfolio percentile band for one metric, or null if not computed. */
export function readPercentileSnapshot(metricKey: string): PercentileSnapshotRow | null {
  const row = getDb()
    .prepare(
      `SELECT metric_key, p25, p50, p75, p90, sample_n, computed_at
         FROM metric_percentile_snapshot WHERE metric_key = ?`,
    )
    .get(metricKey) as RawRow | undefined;
  return row ? toRow(row) : null;
}

/** All computed snapshots (for admin/debug visibility). */
export function listPercentileSnapshots(): PercentileSnapshotRow[] {
  const rows = getDb()
    .prepare(
      `SELECT metric_key, p25, p50, p75, p90, sample_n, computed_at
         FROM metric_percentile_snapshot ORDER BY metric_key`,
    )
    .all() as RawRow[];
  return rows.map(toRow);
}

/** Upsert one metric's portfolio percentile band. */
export function writePercentileSnapshot(
  metricKey: string,
  bands: PercentileBands,
  sampleN: number,
  computedAt: string = new Date().toISOString(),
): void {
  getDb()
    .prepare(
      `INSERT INTO metric_percentile_snapshot
         (metric_key, p25, p50, p75, p90, sample_n, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(metric_key) DO UPDATE SET
         p25         = excluded.p25,
         p50         = excluded.p50,
         p75         = excluded.p75,
         p90         = excluded.p90,
         sample_n    = excluded.sample_n,
         computed_at = excluded.computed_at`,
    )
    .run(metricKey, bands.p25, bands.p50, bands.p75, bands.p90, sampleN, computedAt);
}

/**
 * Linear-interpolated percentile of a numeric sample. Pure helper used by the
 * nightly job; exported for unit tests. Returns 0 for an empty sample.
 */
export function percentileOf(values: number[], p: number): number {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return 0;
  if (xs.length === 1) return xs[0];
  const rank = (p / 100) * (xs.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (rank - lo);
}

export function bandsFromValues(values: number[]): PercentileBands {
  return {
    p25: percentileOf(values, 25),
    p50: percentileOf(values, 50),
    p75: percentileOf(values, 75),
    p90: percentileOf(values, 90),
  };
}
