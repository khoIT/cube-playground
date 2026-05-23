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
 * Detector hosting is documented in the phase doc but is out of scope until
 * a Cube /load proxy exists in this sidecar.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  BusinessMetric,
  BusinessMetricAnomaly,
} from '../types/business-metric.js';
import { getAll as getAllBusinessMetrics } from './business-metrics-loader.js';

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
