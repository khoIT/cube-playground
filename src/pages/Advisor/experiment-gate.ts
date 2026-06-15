/**
 * Experiment hand-off gate — the "is this experiment good enough to set up" rule
 * the Drive → Decide hand-off (decide-drive-view) enforces before the Command
 * Center. The manual Explore → Recommendations hand-off carries the same
 * scorecard on its draft but does NOT yet enforce this gate (deferred — it goes
 * straight to the Command Center stub); wiring the manual path through here is a
 * follow-up. This helper is pure so either path can adopt it without change.
 *
 * It reads the server-computed quality scorecard and HARD-STOPS only on a
 * failing CRITICAL dimension (power / feasibility / provenance) — the three that
 * make an experiment invalid: can't measure it, can't deliver it, or its numbers
 * don't trace to a tool. Non-critical shortfalls (small ₫ materiality, off-goal
 * factor) are surfaced as WARNINGS, not blocks. A blocked experiment can still
 * advance via an explicit, reasoned override (recorded on the draft).
 *
 * No scorecard (pre-scored draft) → not blocked, for back-compat.
 */

import type { DimensionScore, ExperimentScorecard } from '../../api/advisor';

export interface ExperimentGateStatus {
  /** True when a critical dimension failed — the CTA must require an override. */
  blocked: boolean;
  /** Critical dimensions that failed (the hard blockers). */
  criticalFails: DimensionScore[];
  /** Non-critical dimensions that fell short (advisory warnings). */
  warnings: DimensionScore[];
}

export function experimentGateStatus(scorecard?: ExperimentScorecard | null): ExperimentGateStatus {
  if (!scorecard) return { blocked: false, criticalFails: [], warnings: [] };
  const criticalFails = scorecard.dimensions.filter((d) => d.critical && !d.pass);
  const warnings = scorecard.dimensions.filter((d) => !d.critical && !d.pass);
  return { blocked: criticalFails.length > 0, criticalFails, warnings };
}

/** Human label for a quality dimension (UI). */
export const DIMENSION_LABEL: Record<DimensionScore['dimension'], string> = {
  power: 'Powered',
  feasibility: 'Deliverable lever',
  materiality: 'Material ₫',
  provenance: 'Numbers traceable',
  goalFit: 'On-goal',
};
