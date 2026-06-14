/**
 * Treatment-Effect Library: reads expected-effect priors keyed by
 * (game, segment_shape, lever_family) from the SQLite store.
 *
 * Read path: getPrior(game, shape, lever) → EffectPrior | null
 *   Returns the most-confident available row (measured > benchmark > assumption).
 *
 * Seed: the migration (053-treatment-effect-library.sql) pre-populates game-ops
 * defaults labeled 'assumption', including the win-back +6 pp prior for cfm_vn.
 *
 * Write-back (flywheel): recordResult() is a documented STUB. When command-center
 * experiments complete and an outcome is recorded, the command-center outcome ledger will call this to
 * upsert a 'measured' row keyed by the same (game, shape, lever) tuple, elevating
 * future rankings above the assumption tier automatically.
 * DEFERRED TO PHASE 4 — the interface is defined now to lock the contract.
 *
 * PII: keyed by segment_shape (e.g. "churn-risk"), never by individual member uid.
 */

import { getDb } from '../db/sqlite.js';
import type { EffectConfidence, EffectPrior } from './candidate-types.js';

// ─── DB row shape ─────────────────────────────────────────────────────────────

interface LibraryRow {
  id: string;
  game_id: string;
  segment_shape: string;
  lever_family: string;
  effect_value: number;
  confidence: EffectConfidence;
  source: string;
  experiment_id: string | null;
  recorded_at: string;
}

// Confidence ordering for tie-breaking: lower index = higher priority
const CONFIDENCE_RANK: Record<EffectConfidence, number> = {
  measured: 0,
  benchmark: 1,
  assumption: 2,
};

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the best available prior for (game, segmentShape, leverFamily).
 *
 * "Best" = highest confidence tier. When multiple rows share a confidence level,
 * the most recently recorded one wins (latest experiment result takes precedence).
 *
 * Returns null when no prior exists — the ranker falls back to a hardcoded
 * conservative default (0.03, 'assumption', 'no library entry').
 */
export function getPrior(
  gameId: string,
  segmentShape: string,
  leverFamily: string,
): EffectPrior | null {
  const rows = getDb()
    .prepare(
      `SELECT * FROM treatment_effect_library
        WHERE game_id = ? AND segment_shape = ? AND lever_family = ?
        ORDER BY recorded_at DESC`,
    )
    .all(gameId, segmentShape, leverFamily) as LibraryRow[];

  if (rows.length === 0) return null;

  // Pick the row with the best confidence, breaking ties by recorded_at DESC
  const best = rows.reduce((a, b) =>
    CONFIDENCE_RANK[a.confidence] <= CONFIDENCE_RANK[b.confidence] ? a : b,
  );

  return {
    value: best.effect_value,
    confidence: best.confidence,
    source: best.source,
  };
}

/**
 * Fetch all priors for a game (useful for display/export in the Advisor UI).
 */
export function listPriors(gameId: string): LibraryRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM treatment_effect_library
        WHERE game_id = ?
        ORDER BY segment_shape, lever_family, recorded_at DESC`,
    )
    .all(gameId) as LibraryRow[];
}

// ─── Write-back stub (outcome flywheel) ──────────────────────────────────────

export interface ExperimentResult {
  gameId: string;
  segmentShape: string;
  leverFamily: string;
  /** Observed absolute effect as a fraction (e.g. 0.08 = +8 pp). */
  observedEffect: number;
  /** Opaque experiment ID from the command-center ledger. */
  experimentId: string;
  /** ISO-8601 timestamp when the result was evaluated. */
  recordedAt?: string;
}

/**
 * Record a completed experiment result back into the library.
 *
 * STUB — NOT YET IMPLEMENTED.
 *
 * When the command-center outcome ledger ships, this function will
 * upsert a 'measured' row, elevating future rankings for this (game, shape,
 * lever) combination above assumption/benchmark priors automatically.
 *
 * The UNIQUE index on (game_id, segment_shape, lever_family) ensures that a
 * second completed experiment replaces the first 'measured' row rather than
 * accumulating stale results. If multi-experiment averaging is desired later,
 * the index should be relaxed and getPrior() updated to aggregate.
 *
 * Deferred until command-center outcome integration ships.
 */
export function recordResult(_result: ExperimentResult): void {
  // DEFERRED TO PHASE 4: upsert a 'measured' row into treatment_effect_library.
  // Contract for implementer:
  //   INSERT INTO treatment_effect_library
  //     (game_id, segment_shape, lever_family, effect_value, confidence, source, experiment_id, recorded_at)
  //   VALUES (?, ?, ?, ?, 'measured', ?, ?, ?)
  //   ON CONFLICT (game_id, segment_shape, lever_family) DO UPDATE SET
  //     effect_value  = excluded.effect_value,
  //     confidence    = 'measured',
  //     source        = excluded.source,
  //     experiment_id = excluded.experiment_id,
  //     recorded_at   = excluded.recorded_at;
  throw new Error(
    'recordResult() is a stub — command-center outcome integration not yet built.',
  );
}
