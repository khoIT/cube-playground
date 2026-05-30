/**
 * Anomaly detector — two modes in one file:
 *
 *  1. Legacy JSON mode (maybeRunAnomalyDetector / runDetectorOnce):
 *     Reads business-metric YAML, queries Cube, writes anomaly-state.json.
 *     Kept for backward-compat with `cron-runner`.
 *
 *  2. Phase-2 SQLite mode (startAnomalyDetector / runDetectorTick):
 *     Iterates ANOMALY_METRICS per game, queries Cube, upserts rows into
 *     the `anomalies` SQLite table. Gated by ANOMALY_DETECTOR_ENABLED=true.
 *     Interval: 15 min (ANOMALY_DETECTOR_INTERVAL_MS override supported).
 *
 * Concurrency: per-game in-memory mutex — a second tick won't re-enter a
 * game whose query is still in-flight.
 * Budget cap: ANOMALY_QUERY_BUDGET_PER_TICK (default 20) Cube loads per tick.
 */

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load, getMeta } from '../services/cube-client.js';
import { resolveCubeTokenForGame } from '../services/resolve-cube-token.js';
import { loadGamesConfig } from '../services/games-config-loader.js';
import { getAll as getAllBusinessMetrics } from '../services/business-metrics-loader.js';
import { planMetricQueries, type CubeMeta } from '../services/metric-query-planner.js';
import { snapshotFromMeta, validateRefs } from '../services/metric-ref-validator.js';
import { filterApplicable } from '../services/metric-applicability.js';
import { classifySeries } from '../services/z-score.js';
import { ANOMALY_METRICS, classifySeverity } from '../services/anomaly-config.js';
import { upsertAnomaly } from '../services/anomaly-state-store.js';
import { getDb } from '../db/sqlite.js';
import { upsertDriftRows, listDriftRows } from '../db/metric-drift-snapshot-store.js';
import { recordDriftRun, type DriftRunSource, type DriftRunStatus } from '../db/metric-drift-run-store.js';
import { groupDriftByRootCause } from '../services/metric-drift-grouping.js';
import type { AnomalyStateFile, AnomalyStateRecord } from '../services/anomaly-state-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE_FILE = resolve(__dirname, '..', '..', 'data', 'anomaly-state.json');
const DEFAULT_LEGACY_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const DEFAULT_SQLITE_INTERVAL_MS = 15 * 60 * 1000; // 15 min
const DEFAULT_QUERY_BUDGET = 20;

// ─── Legacy JSON detector state ───────────────────────────────────────────────

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
  sqliteIntervalId = null;
  gameInflight.clear();
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

/** One day's value, carrying its date so ratios can align on it. */
export interface DatedValue {
  /** Calendar day, YYYY-MM-DD. */
  date: string;
  value: number;
}

/**
 * Cube rows → date-tagged values sorted ascending by day. Keeps the date (not
 * just the number) so a ratio can pair numerator/denominator on the same day —
 * the two measures may come from different cubes with different date coverage.
 */
export function rowsToDatedSeries(
  rows: Array<Record<string, unknown>>,
  measureField: string,
  timeDimensionField: string,
): DatedValue[] {
  const dayKey = `${timeDimensionField}.day`;
  const out: DatedValue[] = [];
  for (const r of rows) {
    const n = asNumber(r[measureField]);
    if (n == null) continue;
    // Slice to YYYY-MM-DD so a timestamp-valued day still matches a plain date
    // from the other cube.
    const date = String(r[dayKey] ?? r[timeDimensionField] ?? '').slice(0, 10);
    if (date.length !== 10) continue;
    out.push({ date, value: n });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * Ratio of two dated series, aligned on matching dates (NOT by position). Days
 * present in only one series — e.g. a stale denominator that lags the
 * numerator, or an interior gap — are dropped rather than silently paired with
 * the wrong day. Result is ordered by numerator date ascending.
 */
export function divideByDate(num: DatedValue[], den: DatedValue[]): number[] {
  const denByDate = new Map(den.map((d) => [d.date, d.value]));
  const out: number[] = [];
  for (const n of num) {
    const d = denByDate.get(n.date);
    if (d == null || d === 0) continue;
    out.push(n.value / d);
  }
  return out;
}

interface DriftReconcileResult {
  meta: CubeMeta | null;
  token: string | null;
  /** Metric ids with at least one unresolved ref — skipped by the anomaly pass. */
  unresolvedIds: Set<string>;
}

const ZERO_COUNTS = {
  totalUnresolved: 0,
  rootCauseCount: 0,
  newCount: 0,
  resolvedCount: 0,
  cubeMissing: 0,
  memberMissing: 0,
  unparseable: 0,
};

/**
 * Reconcile every registry metric's formula refs against a game's live /meta,
 * persist the unresolved set (snapshot) AND append a run-history row with the
 * deltas vs the previous run. Shared by the scheduled scan (source='detector')
 * and the on-demand "Run now" endpoint (source='manual'). Records a 'skipped'
 * run when no Cube token, an 'error' run when /meta fails, else 'ok'.
 *
 * Returns meta/token/unresolvedIds so the caller (scanGameLegacy) can reuse them
 * for the anomaly z-score pass without a second /meta fetch.
 */
export async function runDriftReconciliation(
  game: string,
  source: DriftRunSource,
  warn: (msg: string) => void = (m) => console.warn(m),
): Promise<DriftReconcileResult> {
  const startedAt = new Date().toISOString();
  const record = (status: DriftRunStatus, counts: typeof ZERO_COUNTS): void => {
    try {
      recordDriftRun(getDb(), { game, source, status, startedAt, finishedAt: new Date().toISOString(), ...counts });
    } catch (err) {
      warn(`[anomaly-detector] drift run record failed for game="${game}": ${(err as Error).message}`);
    }
  };

  const token = resolveCubeTokenForGame(game);
  if (!token) {
    warn(`[anomaly-detector] no Cube token for game="${game}"; skipping`);
    record('skipped', ZERO_COUNTS);
    return { meta: null, token: null, unresolvedIds: new Set() };
  }
  let meta: CubeMeta;
  try {
    meta = (await getMeta(token)) as CubeMeta;
  } catch (err) {
    warn(`[anomaly-detector] /meta failed for game="${game}": ${(err as Error).message}`);
    record('error', ZERO_COUNTS);
    return { meta: null, token, unresolvedIds: new Set() };
  }

  // Validate refs up front: a ref pointing at a measure the deployed cube model
  // doesn't define would 400 on /load every tick. Skip those for the anomaly
  // pass; persist + report only the registry-applicable ones so the detector
  // count matches the live Drift Center path (N/A is registry-scoped).
  const metrics = getAllBusinessMetrics();
  const byId = new Map(metrics.map((m) => [m.id, m]));
  const allUnresolved = validateRefs(metrics, snapshotFromMeta(meta));
  const unresolvedIds = new Set(allUnresolved.map((u) => u.metricId));
  const reportable = filterApplicable(allUnresolved, byId, game);

  // Delta vs the previous detector snapshot — read BEFORE the upsert overwrites
  // it. new = refs that broke this run; resolved = refs that recovered.
  const prevKeys = new Set(
    listDriftRows(getDb(), { workspaceId: 'local', game, source: 'detector' }).map((r) => `${r.metricId}|${r.ref}`),
  );
  const nextKeys = new Set(reportable.map((u) => `${u.metricId}|${u.ref}`));
  let newCount = 0;
  for (const k of nextKeys) if (!prevKeys.has(k)) newCount++;
  let resolvedCount = 0;
  for (const k of prevKeys) if (!nextKeys.has(k)) resolvedCount++;

  const byReason = { 'cube-missing': 0, 'member-missing': 0, unparseable: 0 };
  for (const u of reportable) byReason[u.reason]++;

  // Persist the per-game unresolved set (Drift Center "live detector run" data).
  // Detector stays on the local game_id model. rows:[] clears a resolved game.
  // Best-effort: a SQLite hiccup must NOT abort the caller's scan loop.
  try {
    upsertDriftRows(getDb(), {
      workspaceId: 'local',
      game,
      source: 'detector',
      rows: reportable.map((u) => ({ metricId: u.metricId, ref: u.ref, reason: u.reason })),
    });
  } catch (err) {
    warn(`[anomaly-detector] drift snapshot persist failed for game="${game}": ${(err as Error).message}`);
  }

  if (reportable.length > 0) {
    const reportableIds = new Set(reportable.map((u) => u.metricId));
    warn(`[anomaly-detector] game="${game}": ${reportableIds.size} metric(s) have unresolved refs — see Drift Center`);
  }

  record('ok', {
    totalUnresolved: reportable.length,
    rootCauseCount: groupDriftByRootCause(reportable).length,
    newCount,
    resolvedCount,
    cubeMissing: byReason['cube-missing'],
    memberMissing: byReason['member-missing'],
    unparseable: byReason.unparseable,
  });

  return { meta, token, unresolvedIds };
}

async function scanGameLegacy(
  game: string,
  warn: (msg: string) => void,
): Promise<Record<string, AnomalyStateRecord>> {
  const { meta, token, unresolvedIds } = await runDriftReconciliation(game, 'detector', warn);
  if (!meta || !token) return {};

  // Drift reconcile (snapshot + run history) already ran inside the call above.
  // In drift-only mode, stop here — skip the per-metric /load anomaly pass that
  // queries Trino.
  if (driftOnly()) return {};

  const metrics = getAllBusinessMetrics();
  const out: Record<string, AnomalyStateRecord> = {};
  for (const metric of metrics) {
    if (unresolvedIds.has(metric.id)) continue;
    const plan = planMetricQueries(metric, meta);
    if ('skip' in plan) continue;
    try {
      const numRes = (await load(plan.numerator, token)) as CubeLoadResult;
      let series: number[];
      if (plan.denominator) {
        const denRes = (await load(plan.denominator, token)) as CubeLoadResult;
        const numSeries = rowsToDatedSeries(numRes.data, plan.numerator.measures[0], plan.numerator.timeDimensions[0].dimension);
        const denSeries = rowsToDatedSeries(denRes.data, plan.denominator.measures[0], plan.denominator.timeDimensions[0].dimension);
        series = divideByDate(numSeries, denSeries);
      } else {
        series = rowsToDatedSeries(numRes.data, plan.numerator.measures[0], plan.numerator.timeDimensions[0].dimension).map((d) => d.value);
      }
      const cls = classifySeries(series);
      if (!cls) continue;
      out[metric.id] = {
        state: cls.state,
        deltaPct: Math.round(cls.deltaPct * 10) / 10,
        period: `last day vs prior ${series.length - 1}d`,
      };
    } catch (err) {
      warn(`[anomaly-detector] /load failed for ${game}:${metric.id}: ${(err as Error).message}`);
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

export async function runDetectorOnce(
  warn: (msg: string) => void = (m) => console.warn(m),
): Promise<{ states: AnomalyStateFile['states']; entries: number }> {
  const states: AnomalyStateFile['states'] = {};
  for (const game of gamesToScan()) {
    const perGame = await scanGameLegacy(game, warn);
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

/**
 * Drift-only mode: run just the cheap `/meta` ref reconciliation (which feeds
 * the Drift Center) and skip the expensive per-metric `/load` anomaly pass.
 * Removes the Trino data-source dependency — useful in dev where Trino may be
 * unreachable. The anomaly archive goes stale; drift history keeps updating.
 */
function driftOnly(): boolean {
  return process.env.ANOMALY_DETECTOR_DRIFT_ONLY === '1';
}

function legacyIntervalMs(): number {
  const raw = process.env.ANOMALY_DETECTOR_INTERVAL_MS;
  if (!raw) return DEFAULT_LEGACY_INTERVAL_MS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LEGACY_INTERVAL_MS;
}

/**
 * Cadence of the scheduled drift reconciliation (the legacy scan that feeds the
 * Drift Center detector log). The "Detector runs" tab uses this to estimate the
 * next run: last started_at + this interval.
 */
export function driftReconcileIntervalMs(): number {
  return legacyIntervalMs();
}

export async function maybeRunAnomalyDetector(now: number = Date.now()): Promise<void> {
  if (detectorDisabled()) return;
  if (inflight) return;
  if (now - lastRunAt < legacyIntervalMs()) return;
  inflight = (async () => {
    try {
      const result = await runDetectorOnce();
      lastRunAt = Date.now();
      console.log(`[anomaly-detector] wrote ${result.entries} state(s)`);
    } catch (err) {
      console.warn('[anomaly-detector] run failed:', (err as Error).message);
    } finally {
      inflight = null;
    }
  })();
  await inflight;
}

// ─── Phase-2 SQLite detector ──────────────────────────────────────────────────

/** Per-game in-memory mutex: prevents overlapping ticks for same game. */
const gameInflight = new Map<string, boolean>();
let sqliteIntervalId: ReturnType<typeof setInterval> | null = null;

function sqliteIntervalMs(): number {
  const raw = process.env.ANOMALY_DETECTOR_INTERVAL_MS;
  if (!raw) return DEFAULT_SQLITE_INTERVAL_MS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SQLITE_INTERVAL_MS;
}

function queryBudget(): number {
  const raw = process.env.ANOMALY_QUERY_BUDGET_PER_TICK;
  if (!raw) return DEFAULT_QUERY_BUDGET;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_QUERY_BUDGET;
}

/**
 * Runs a single SQLite-mode detector tick for all configured games + metrics.
 * Exported for testing with synthetic data injection.
 */
export async function runDetectorTick(
  warn: (msg: string) => void = (m) => console.warn(m),
): Promise<{ checked: number; upserted: number; skipped: number }> {
  const budget = queryBudget();
  let queriesUsed = 0;
  let checked = 0;
  let upserted = 0;
  let skipped = 0;

  const games = loadGamesConfig().games.map((g) => g.id);

  for (const game of games) {
    if (gameInflight.get(game)) {
      warn(`[anomaly-detector] tick still in-flight for game="${game}"; skipping`);
      skipped++;
      continue;
    }

    const metrics = ANOMALY_METRICS[game] ?? [];
    if (metrics.length === 0) continue;

    gameInflight.set(game, true);
    try {
      const token = resolveCubeTokenForGame(game);
      if (!token) {
        warn(`[anomaly-detector] no Cube token for game="${game}"; skipping`);
        continue;
      }

      for (const cfg of metrics) {
        if (queriesUsed >= budget) {
          warn(`[anomaly-detector] query budget (${budget}) reached; skipping remaining metrics`);
          skipped++;
          continue;
        }

        try {
          const endDate = new Date();
          const startDate = new Date(endDate);
          startDate.setDate(startDate.getDate() - 13); // last 14 days inclusive

          const query = {
            measures: [cfg.metric],
            timeDimensions: [{
              dimension: cfg.timeDim,
              granularity: 'day',
              dateRange: [
                startDate.toISOString().slice(0, 10),
                endDate.toISOString().slice(0, 10),
              ],
            }],
            order: { [cfg.timeDim]: 'asc' },
          };

          const res = (await load(query, token)) as CubeLoadResult;
          queriesUsed++;
          checked++;

          const timeDimDay = `${cfg.timeDim}.day`;
          const series = rowsToDatedSeries(res.data, cfg.metric, cfg.timeDim).map((d) => d.value);

          if (series.length < 6) {
            // z-score needs at least MIN_BASELINE+1=6 points
            continue;
          }

          const cls = classifySeries(series);
          if (!cls || cls.state === 'none' || cls.state === 'trend') continue;

          const severity = classifySeverity(Math.abs(cls.z), cfg);
          if (!severity) continue;

          // Latest data point's date for idempotent key
          const lastRow = [...res.data].sort((a, b) =>
            String(a[timeDimDay] ?? '').localeCompare(String(b[timeDimDay] ?? ''))
          ).at(-1);
          const tsRaw = String(lastRow?.[timeDimDay] ?? new Date().toISOString().slice(0, 10));
          const ts = tsRaw.slice(0, 10); // normalize to YYYY-MM-DD

          const baseline = series.slice(0, -1).reduce((s, v) => s + v, 0) / (series.length - 1);
          const observed = series[series.length - 1];

          upsertAnomaly({ game, metric: cfg.metric, severity, baseline, observed, ts });
          upserted++;
        } catch (err) {
          warn(`[anomaly-detector] metric "${cfg.metric}" for game="${game}" failed: ${(err as Error).message}`);
        }
      }
    } finally {
      gameInflight.delete(game);
    }
  }

  return { checked, upserted, skipped };
}

/**
 * Start the SQLite-mode detector interval.
 * Gated by `ANOMALY_DETECTOR_ENABLED=true`. Safe to call multiple times —
 * only starts one interval.
 */
export function startAnomalyDetector(
  warn: (msg: string) => void = (m) => console.warn(m),
): void {
  if (process.env.ANOMALY_DETECTOR_ENABLED !== 'true') {
    console.info('[anomaly-detector] SQLite mode disabled (ANOMALY_DETECTOR_ENABLED != true)');
    return;
  }
  if (driftOnly()) {
    // SQLite mode is a pure anomaly /load pass (no drift reconcile) — nothing to
    // do in drift-only mode.
    console.info('[anomaly-detector] drift-only mode — SQLite anomaly pass skipped');
    return;
  }
  if (sqliteIntervalId !== null) return; // already started

  console.info(`[anomaly-detector] SQLite mode enabled; interval=${sqliteIntervalMs()}ms`);

  // Run first tick on next event loop turn so startup is non-blocking
  setImmediate(() => {
    runDetectorTick(warn).catch((err) =>
      warn(`[anomaly-detector] initial tick failed: ${(err as Error).message}`)
    );
  });

  sqliteIntervalId = setInterval(() => {
    runDetectorTick(warn).catch((err) =>
      warn(`[anomaly-detector] tick failed: ${(err as Error).message}`)
    );
  }, sqliteIntervalMs());
}
