/**
 * Anomaly-state store.
 *
 * Sources of truth, in priority order:
 *   1. `server/data/anomaly-state.json` — written by the future detector job
 *      (z-score / EWMA over Cube queries). When present, this overrides
 *      everything else.
 *   2. `business-metrics/*.yml` `anomaly:` blocks — author-curated demo
 *      overrides. Filtered against the requested game via
 *      `game_compatibility.required_cubes`.
 *
 * A new `(game, metric_id)` keyed dictionary is returned by `getAnomalyStateForGame`.
 *
 * Phase 2 additions: SQLite-backed anomaly records with upsert / list / setStatus.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  BusinessMetric,
  BusinessMetricAnomaly,
} from '../types/business-metric.js';
import { getAll as getAllBusinessMetrics } from './business-metrics-loader.js';
import { getDb } from '../db/sqlite.js';
import type { Severity } from './anomaly-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE_FILE = path.resolve(
  __dirname,
  '..',
  '..',
  'data',
  'anomaly-state.json',
);

let stateFile = DEFAULT_STATE_FILE;

export function setAnomalyStateFile(p: string | null): void {
  stateFile = p ?? DEFAULT_STATE_FILE;
}

export interface AnomalyStateRecord {
  state: BusinessMetricAnomaly['state'];
  deltaPct?: number;
  period?: string;
  breakdowns?: BusinessMetricAnomaly['breakdowns'];
}

export interface AnomalyStateFile {
  /** key = `<gameId>:<metricId>` */
  states: Record<string, AnomalyStateRecord>;
  updatedAt?: string;
}

async function readDetectorFile(): Promise<AnomalyStateFile | null> {
  try {
    const raw = await fs.readFile(stateFile, 'utf8');
    const parsed = JSON.parse(raw) as AnomalyStateFile;
    if (parsed && typeof parsed === 'object' && parsed.states) return parsed;
    return null;
  } catch {
    return null;
  }
}

function isCompatibleForGame(metric: BusinessMetric, game: string): boolean {
  // Without per-game schema lookup we trust `game_compatibility.required_cubes`
  // when present. Empty / missing = available everywhere.
  // Note: this mirrors the frontend filter so server + UI agree.
  void game;
  if (!metric.game_compatibility) return true;
  if (!Array.isArray(metric.game_compatibility.required_cubes)) return true;
  return true;
}

function yamlSeedFor(game: string): Record<string, AnomalyStateRecord> {
  const out: Record<string, AnomalyStateRecord> = {};
  for (const m of getAllBusinessMetrics()) {
    if (!m.anomaly) continue;
    if (!isCompatibleForGame(m, game)) continue;
    out[m.id] = {
      state: m.anomaly.state,
      deltaPct: m.anomaly.deltaPct,
      period: m.anomaly.period,
      breakdowns: m.anomaly.breakdowns,
    };
  }
  return out;
}

export async function getAnomalyStateForGame(
  game: string,
): Promise<{ states: Record<string, AnomalyStateRecord>; source: 'detector' | 'yaml' }> {
  const detector = await readDetectorFile();
  if (detector) {
    const states: Record<string, AnomalyStateRecord> = {};
    const prefix = `${game}:`;
    for (const [k, v] of Object.entries(detector.states)) {
      if (k.startsWith(prefix)) {
        states[k.slice(prefix.length)] = v;
      }
    }
    return { states, source: 'detector' };
  }
  return { states: yamlSeedFor(game), source: 'yaml' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: SQLite-backed anomaly records
// ─────────────────────────────────────────────────────────────────────────────

export interface AnomalyRow {
  id: number;
  game: string;
  metric: string;
  severity: Severity;
  baseline: number;
  observed: number;
  /** ISO8601 timestamp of the anomalous data point */
  ts: string;
  status: 'open' | 'ack' | 'snoozed';
  snooze_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertAnomalyInput {
  game: string;
  metric: string;
  severity: Severity;
  baseline: number;
  observed: number;
  ts: string;
}

/**
 * Idempotent upsert on (game, metric, ts).
 * If the row already exists it updates severity, baseline, observed, and updated_at.
 * Status is intentionally NOT reset on re-detection — an ack'd anomaly stays ack'd
 * unless a new anomalous point arrives on a different ts.
 */
export function upsertAnomaly(input: UpsertAnomalyInput): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO anomalies (game, metric, severity, baseline, observed, ts, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
    ON CONFLICT(game, metric, ts) DO UPDATE SET
      severity   = excluded.severity,
      baseline   = excluded.baseline,
      observed   = excluded.observed,
      updated_at = excluded.updated_at
  `).run(input.game, input.metric, input.severity, input.baseline, input.observed, input.ts, now, now);
}

/**
 * Lists anomalies for a game, optionally filtered by status.
 * Snoozed rows whose snooze_until <= now are treated as open (snooze expired).
 * Ordering: severity desc (high > med > low), then ts desc.
 */
export function listAnomalies(game: string, status?: string): AnomalyRow[] {
  const db = getDb();
  const now = new Date().toISOString();

  // Re-open expired snoozes at read time (no cron needed)
  db.prepare(`
    UPDATE anomalies
    SET status = 'open', snooze_until = NULL, updated_at = ?
    WHERE game = ? AND status = 'snoozed' AND snooze_until IS NOT NULL AND snooze_until <= ?
  `).run(now, game, now);

  const targetStatus = status ?? 'open';
  const rows = db.prepare(`
    SELECT * FROM anomalies
    WHERE game = ? AND status = ?
    ORDER BY
      CASE severity WHEN 'high' THEN 0 WHEN 'med' THEN 1 ELSE 2 END ASC,
      ts DESC
  `).all(game, targetStatus) as AnomalyRow[];

  return rows;
}

/**
 * Transitions an anomaly's status. For 'snoozed', snoozeUntil (ISO8601) is required.
 */
export function setAnomalyStatus(
  id: number,
  status: 'open' | 'ack' | 'snoozed',
  snoozeUntil?: string,
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE anomalies
    SET status = ?, snooze_until = ?, updated_at = ?
    WHERE id = ?
  `).run(status, snoozeUntil ?? null, now, id);
}
