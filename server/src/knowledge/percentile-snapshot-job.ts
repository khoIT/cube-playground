/**
 * Nightly internal-benchmark job: computes portfolio percentile bands.
 *
 * For each tracked metric, take ONE trailing-30d value per live game, then the
 * p25/p50/p75/p90 ACROSS the game set — the "what's normal across our games"
 * reference the benchmark resolver joins onto each lever.
 *
 * Opt-in: gated by PERCENTILE_SNAPSHOT_ENABLED=true (off in dev/CI). The metric
 * registry is intentionally small and DRAFTED for verification — per-game
 * measure names vary, so the job is resilient (a failing game/metric is
 * skipped, never fatal) and is meant to be extended after an analyst pass.
 * Until it runs, lever benchmarks simply carry no internal band (external norm
 * still shows).
 */

import { load } from '../services/cube-client.js';
import { resolveCubeTokenForGame } from '../services/resolve-cube-token.js';
import { resolveGamePrefix } from '../services/resolve-game-prefix.js';
import { physicalizeQuery } from '../services/cube-member-resolver.js';
import { loadGamesConfig } from '../services/games-config-loader.js';
import { bandsFromValues, writePercentileSnapshot } from './percentile-snapshot-store.js';

type Reduce = 'avg' | 'sum' | 'last';

interface TrackedMetric {
  /** Joins to lever benchmark.metricKey. */
  metricKey: string;
  /** Cube measure to query. */
  measure: string;
  /** Time dimension for the trailing window. */
  timeDim: string;
  /** How daily values collapse to one per-game value. */
  reduce: Reduce;
}

/**
 * DRAFT registry — verify measure names per game before extending. Kept to
 * normalized, single-measure metrics (ratios/derived metrics need their own
 * planner and come later). ARPPU is a good first band: comparable across games.
 */
const TRACKED_METRICS: TrackedMetric[] = [
  { metricKey: 'arppu_vnd', measure: 'recharge.arppu_vnd', timeDim: 'recharge.recharge_date', reduce: 'avg' },
];

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // nightly
const WINDOW_DAYS = 30;

interface CubeLoadResult {
  data: Array<Record<string, unknown>>;
}

function asNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function reduceValues(values: number[], mode: Reduce): number | null {
  if (values.length === 0) return null;
  if (mode === 'sum') return values.reduce((s, v) => s + v, 0);
  if (mode === 'last') return values[values.length - 1];
  return values.reduce((s, v) => s + v, 0) / values.length; // avg
}

function disabled(): boolean {
  if (process.env.NODE_ENV === 'test') return true;
  return process.env.PERCENTILE_SNAPSHOT_ENABLED !== 'true';
}

/** Query one game's trailing-30d values for a metric and reduce to a scalar. */
async function gameValue(game: string, m: TrackedMetric): Promise<number | null> {
  const token = resolveCubeTokenForGame(game);
  if (!token) return null;
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - (WINDOW_DAYS - 1));
  const query = {
    measures: [m.measure],
    timeDimensions: [
      {
        dimension: m.timeDim,
        granularity: 'day',
        dateRange: [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)],
      },
    ],
    order: { [m.timeDim]: 'asc' },
  };
  const res = (await load(physicalizeQuery(query, resolveGamePrefix(game)), token, 120_000)) as CubeLoadResult;
  const vals = res.data.map((r) => asNumber(r[m.measure])).filter((n): n is number => n != null);
  return reduceValues(vals, m.reduce);
}

export interface SnapshotRunResult {
  metricsComputed: number;
  metricsSkipped: number;
}

/** Compute + persist portfolio bands for every tracked metric. Resilient: a
 *  metric with too few contributing games is skipped, not fatal. */
export async function runPercentileSnapshotOnce(
  warn: (msg: string) => void = (m) => console.warn(m),
): Promise<SnapshotRunResult> {
  const games = loadGamesConfig().games.map((g) => g.id);
  const computedAt = new Date().toISOString();
  let metricsComputed = 0;
  let metricsSkipped = 0;

  for (const metric of TRACKED_METRICS) {
    const values: number[] = [];
    for (const game of games) {
      try {
        const v = await gameValue(game, metric);
        if (v != null) values.push(v);
      } catch (err) {
        warn(`[percentile-snapshot] ${metric.metricKey} game="${game}" failed: ${(err as Error).message}`);
      }
    }
    if (values.length < 3) {
      warn(`[percentile-snapshot] ${metric.metricKey}: only ${values.length} game(s) — skipping (need >=3)`);
      metricsSkipped++;
      continue;
    }
    writePercentileSnapshot(metric.metricKey, bandsFromValues(values), values.length, computedAt);
    metricsComputed++;
  }
  return { metricsComputed, metricsSkipped };
}

// ── Scheduler hook (called from cron-runner tick) ────────────────────────────

let lastRunAt = 0;
let inflight: Promise<void> | null = null;

export function __resetPercentileSnapshotState(): void {
  lastRunAt = 0;
  inflight = null;
}

export async function maybeRunPercentileSnapshot(now: number = Date.now()): Promise<void> {
  if (disabled()) return;
  if (inflight) return;
  if (now - lastRunAt < DEFAULT_INTERVAL_MS) return;
  inflight = (async () => {
    try {
      const r = await runPercentileSnapshotOnce();
      lastRunAt = Date.now();
      console.log(`[percentile-snapshot] computed=${r.metricsComputed} skipped=${r.metricsSkipped}`);
    } catch (err) {
      console.warn('[percentile-snapshot] run failed:', (err as Error).message);
    } finally {
      inflight = null;
    }
  })();
  await inflight;
}
