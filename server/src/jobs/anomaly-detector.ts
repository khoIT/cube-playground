/**
 * Scheduled anomaly detector — wires the business-metrics registry to Cube
 * /load, computes z-score per `(game, metric)`, atomically writes
 * `server/data/anomaly-state.json` so the anomaly-state-store reads it as
 * the "detector" source instead of the YAML fallback.
 *
 * Triggered by `cron-runner` (every 60s tick) but throttled internally to
 * `ANOMALY_DETECTOR_INTERVAL_MS` so we don't hammer Cube every minute.
 *
 * Feature-gated: when no per-game token resolves *and* no global CUBE_TOKEN
 * is set, the detector is a no-op and the UI falls back to the YAML seeds.
 * Tests can opt-out via `ANOMALY_DETECTOR_DISABLED=1`.
 */

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load, getMeta } from '../services/cube-client.js';
import { resolveCubeTokenForGame } from '../services/resolve-cube-token.js';
import { loadGamesConfig } from '../services/games-config-loader.js';
import { getAll as getAllBusinessMetrics } from '../services/business-metrics-loader.js';
import {
  planMetricQueries,
  type CubeMeta,
} from '../services/metric-query-planner.js';
import { classifySeries } from '../services/z-score.js';
import type {
  AnomalyStateFile,
  AnomalyStateRecord,
} from '../services/anomaly-state-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE_FILE = resolve(__dirname, '..', '..', 'data', 'anomaly-state.json');
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
// No literal game-id list — when ANOMALY_DETECTOR_GAMES is unset we scan every
// game in gds.config.json so adding a game in the registry never silently
// excludes it from anomaly detection.

let lastRunAt = 0;
let stateFile = DEFAULT_STATE_FILE;
let inflight: Promise<void> | null = null;

export function setAnomalyDetectorStateFile(p: string): void {
  stateFile = p;
}

export function __resetAnomalyDetectorState(): void {
  lastRunAt = 0;
  inflight = null;
  stateFile = DEFAULT_STATE_FILE;
}

function gamesToScan(): string[] {
  const raw = process.env.ANOMALY_DETECTOR_GAMES;
  if (raw && raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return loadGamesConfig().games.map((g) => g.id);
}

interface CubeLoadResult {
  data: Array<Record<string, unknown>>;
}

function asNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Project a Cube /load result to a chronologically-ordered number series. */
function rowsToSeries(
  rows: Array<Record<string, unknown>>,
  measureField: string,
  timeDimensionField: string,
): number[] {
  const dayKey = `${timeDimensionField}.day`;
  const sorted = [...rows].sort((a, b) => {
    const ad = String(a[dayKey] ?? a[timeDimensionField] ?? '');
    const bd = String(b[dayKey] ?? b[timeDimensionField] ?? '');
    return ad.localeCompare(bd);
  });
  const out: number[] = [];
  for (const r of sorted) {
    const n = asNumber(r[measureField]);
    if (n != null) out.push(n);
  }
  return out;
}

function divideSeries(num: number[], den: number[]): number[] {
  const len = Math.min(num.length, den.length);
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    if (den[i] === 0) continue;
    out.push(num[i] / den[i]);
  }
  return out;
}

async function scanGame(
  game: string,
  warn: (msg: string) => void,
): Promise<Record<string, AnomalyStateRecord>> {
  const token = resolveCubeTokenForGame(game);
  if (!token) {
    warn(`[anomaly-detector] no Cube token for game="${game}"; skipping`);
    return {};
  }

  let meta: CubeMeta;
  try {
    meta = (await getMeta(token)) as CubeMeta;
  } catch (err) {
    warn(`[anomaly-detector] /meta failed for game="${game}": ${(err as Error).message}`);
    return {};
  }

  const out: Record<string, AnomalyStateRecord> = {};
  for (const metric of getAllBusinessMetrics()) {
    const plan = planMetricQueries(metric, meta);
    if ('skip' in plan) continue;
    try {
      const numRes = (await load(plan.numerator, token)) as CubeLoadResult;
      let series: number[];
      if (plan.denominator) {
        const denRes = (await load(plan.denominator, token)) as CubeLoadResult;
        const numSeries = rowsToSeries(
          numRes.data,
          plan.numerator.measures[0],
          plan.numerator.timeDimensions[0].dimension,
        );
        const denSeries = rowsToSeries(
          denRes.data,
          plan.denominator.measures[0],
          plan.denominator.timeDimensions[0].dimension,
        );
        series = divideSeries(numSeries, denSeries);
      } else {
        series = rowsToSeries(
          numRes.data,
          plan.numerator.measures[0],
          plan.numerator.timeDimensions[0].dimension,
        );
      }
      const cls = classifySeries(series);
      if (!cls) continue;
      out[metric.id] = {
        state: cls.state,
        deltaPct: Math.round(cls.deltaPct * 10) / 10,
        period: `last day vs prior ${series.length - 1}d`,
      };
    } catch (err) {
      warn(
        `[anomaly-detector] /load failed for ${game}:${metric.id}: ${(err as Error).message}`,
      );
    }
  }
  return out;
}

async function atomicWrite(file: string, payload: AnomalyStateFile): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${Date.now()}.anomaly-state.tmp`);
  await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
  await rename(tmp, file);
}

/**
 * Run one detector pass. Returns the (game, metric) entries written. Caller
 * decides whether to throttle subsequent invocations.
 */
export async function runDetectorOnce(
  warn: (msg: string) => void = (m) => console.warn(m),
): Promise<{ states: AnomalyStateFile['states']; entries: number }> {
  const states: AnomalyStateFile['states'] = {};
  for (const game of gamesToScan()) {
    const perGame = await scanGame(game, warn);
    for (const [metricId, rec] of Object.entries(perGame)) {
      states[`${game}:${metricId}`] = rec;
    }
  }
  const payload: AnomalyStateFile = { states, updatedAt: new Date().toISOString() };
  await atomicWrite(stateFile, payload);
  return { states, entries: Object.keys(states).length };
}

function detectorDisabled(): boolean {
  if (process.env.ANOMALY_DETECTOR_DISABLED === '1') return true;
  if (process.env.NODE_ENV === 'test') return true;
  return false;
}

function intervalMs(): number {
  const raw = process.env.ANOMALY_DETECTOR_INTERVAL_MS;
  if (!raw) return DEFAULT_INTERVAL_MS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_MS;
}

/**
 * Called from `cron-runner.tick()`. Self-throttles so it only fires once per
 * `intervalMs()`. Safe to call every minute.
 */
export async function maybeRunAnomalyDetector(now: number = Date.now()): Promise<void> {
  if (detectorDisabled()) return;
  if (inflight) return;
  if (now - lastRunAt < intervalMs()) return;
  inflight = (async () => {
    try {
      const result = await runDetectorOnce();
      lastRunAt = Date.now();
      // eslint-disable-next-line no-console
      console.log(`[anomaly-detector] wrote ${result.entries} state(s)`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[anomaly-detector] run failed:', (err as Error).message);
    } finally {
      inflight = null;
    }
  })();
  await inflight;
}
