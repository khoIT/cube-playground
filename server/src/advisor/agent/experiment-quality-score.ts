/**
 * Experiment-QUALITY scoring — the product's reason to exist.
 *
 * The agent is valuable only if the experiments it proposes are POWERFUL,
 * FEASIBLE, ₫-MATERIAL, fully PROVENANCED, and ON-GOAL. This module scores a
 * proposed experiment on those five dimensions and emits a scorecard with a
 * pass/fail gate. It is PURE (no I/O, no LLM) so the eval harness is a
 * deterministic regression tripwire over fixed scenarios — agent text is
 * stochastic, but these gates are the contract regardless of wording.
 *
 * Reused by both the offline fixture eval and the host-gated live OAuth smoke
 * (which feeds a real agent draft through the same scorer).
 */

import { validateDraftNumbers, type ProvenanceLedger } from './agent-provenance-gate.js';

/** The slice of an ExperimentDraft the scorer needs (structural subset). */
export interface ScorableExperiment {
  draftId: string;
  /** `${opportunityFactor}::${leverFamily}` — the factor drives goal-fit. */
  candidateId: string;
  power: { status: 'powered' | 'underpowered'; mde: number };
  feasibility: { status: 'feasible' | 'nearest-feasible' | 'infeasible' };
  money: { incrementalVnd: number | null };
  delivery: 'cs-queue' | 'external';
  expectedEffect?: { value?: number };
  cohort?: { addressableN?: number };
}

export type QualityDimension = 'power' | 'feasibility' | 'materiality' | 'provenance' | 'goalFit';

export interface DimensionScore {
  dimension: QualityDimension;
  /** Continuous 0–1 score (for the scorecard mean). */
  score: number;
  /** Whether this dimension clears its gate. */
  pass: boolean;
  /** Whether failing this dimension fails the whole experiment outright. */
  critical: boolean;
  detail: string;
}

export interface ExperimentScorecard {
  draftId: string;
  dimensions: DimensionScore[];
  /** Mean of the five dimension scores. */
  overall: number;
  /** Passes when every CRITICAL gate clears AND overall ≥ minOverall. */
  pass: boolean;
}

export interface QualityThresholds {
  /** ₫ floor below which an experiment is not worth running. */
  materialityFloorVnd: number;
  /** Overall mean score required to pass (0–1). */
  minOverall: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
  materialityFloorVnd: 10_000_000, // ₫10M incremental floor — below this, not worth CS effort
  minOverall: 0.7,
};

/** Factor keys that belong to each goal tree (mirrors goal-tree.ts builders). */
const GOAL_FACTOR_KEYS: Record<'revenue' | 'engagement', readonly string[]> = {
  revenue: ['payers', 'arppu', 'lifespan'],
  engagement: ['engagement_lifespan', 'session_freq', 'session_length'],
};

/** The opportunity factor a candidate targets (left of the `::` in its id). */
export function factorOf(candidateId: string): string {
  return candidateId.split('::')[0] ?? '';
}

/**
 * Resolve a (possibly 'both') advisor goal to the single goal tree the goal-fit
 * dimension is scored against. When the manager asked for 'both', a lever is
 * on-goal if its factor sits in EITHER tree — so we score against the tree that
 * contains the candidate's factor (else default revenue). This stops a valid
 * engagement lever being marked off-goal just because the goal was 'both'.
 */
export function resolveScoringGoal(
  goal: 'revenue' | 'engagement' | 'both',
  candidateId: string,
): 'revenue' | 'engagement' {
  if (goal !== 'both') return goal;
  return GOAL_FACTOR_KEYS.engagement.includes(factorOf(candidateId)) ? 'engagement' : 'revenue';
}

/**
 * Score one proposed experiment. `provenanceId`+`ledger` are optional: when
 * supplied, the provenance dimension is validated against the live ledger;
 * when absent (pure-fixture mode) it is scored from a pre-resolved flag.
 */
export function scoreExperiment(
  exp: ScorableExperiment,
  goal: 'revenue' | 'engagement',
  opts: {
    thresholds?: QualityThresholds;
    ledger?: ProvenanceLedger;
    provenanceId?: string;
    /** Used only when no ledger is supplied (fixture mode). */
    provenanceResolved?: boolean;
  } = {},
): ExperimentScorecard {
  const t = opts.thresholds ?? DEFAULT_QUALITY_THRESHOLDS;

  // 1. POWER — must be adequately powered for the stated N (critical).
  const powered = exp.power.status === 'powered';
  const power: DimensionScore = {
    dimension: 'power',
    score: powered ? 1 : 0,
    pass: powered,
    critical: true,
    detail: powered ? `powered (MDE ${exp.power.mde}pp)` : `underpowered (MDE ${exp.power.mde}pp)`,
  };

  // 2. FEASIBILITY — is there a registry-backed, deliverable lever (critical
  //    when infeasible). The feasibility STATUS already encodes "CS-actuated
  //    today = feasible"; delivery channel is orthogonal and PLUGGABLE
  //    (cs-queue OR a no-PII external/hand-logged export), so the channel does
  //    NOT gate this dimension — only whether a lever exists at all does.
  const feasScore =
    exp.feasibility.status === 'feasible' ? 1 : exp.feasibility.status === 'nearest-feasible' ? 0.5 : 0;
  const feasibility: DimensionScore = {
    dimension: 'feasibility',
    score: feasScore,
    pass: feasScore >= 0.5,
    critical: true,
    detail: `${exp.feasibility.status}, delivery=${exp.delivery}`,
  };

  // 3. ₫-MATERIALITY — incremental above the floor (non-critical: borderline ok).
  const vnd = exp.money.incrementalVnd;
  const matScore = vnd == null ? 0 : Math.max(0, Math.min(1, vnd / t.materialityFloorVnd));
  const materiality: DimensionScore = {
    dimension: 'materiality',
    score: matScore,
    pass: vnd != null && vnd >= t.materialityFloorVnd,
    critical: false,
    detail: vnd == null ? '₫ TBD (no value/unit)' : `₫${Math.round(vnd).toLocaleString('en-US')} incremental`,
  };

  // 4. PROVENANCE completeness — every published number ledger-backed (critical).
  let provOk: boolean;
  let provDetail: string;
  if (opts.ledger) {
    const violations = validateDraftNumbers(exp, opts.provenanceId, opts.ledger);
    provOk = violations.length === 0;
    provDetail = provOk ? 'all numbers ledger-backed' : `${violations.length} un-provenanced number(s)`;
  } else {
    provOk = opts.provenanceResolved ?? false;
    provDetail = provOk ? 'provenance resolved (fixture)' : 'provenance unresolved (fixture)';
  }
  const provenance: DimensionScore = {
    dimension: 'provenance',
    score: provOk ? 1 : 0,
    pass: provOk,
    critical: true,
    detail: provDetail,
  };

  // 5. GOAL-FIT — the lever's opportunity factor belongs to the stated goal tree.
  const factor = factorOf(exp.candidateId);
  const onGoal = GOAL_FACTOR_KEYS[goal].includes(factor);
  const goalFit: DimensionScore = {
    dimension: 'goalFit',
    score: onGoal ? 1 : 0,
    pass: onGoal,
    critical: false,
    detail: onGoal ? `factor "${factor}" ∈ ${goal} tree` : `factor "${factor}" not in ${goal} tree`,
  };

  const dimensions = [power, feasibility, materiality, provenance, goalFit];
  const overall = dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length;
  const criticalsPass = dimensions.every((d) => !d.critical || d.pass);

  return { draftId: exp.draftId, dimensions, overall, pass: criticalsPass && overall >= t.minOverall };
}

export interface EvalScenario {
  name: string;
  goal: 'revenue' | 'engagement';
  experiment: ScorableExperiment;
  provenanceResolved?: boolean;
}

export interface EvalReport {
  cards: ExperimentScorecard[];
  /** Fraction of scenarios that passed. */
  passRate: number;
  /** Mean overall score across scenarios. */
  meanOverall: number;
}

/** Run the scorer across a fixed scenario set and summarize. */
export function runEval(scenarios: EvalScenario[], thresholds?: QualityThresholds): EvalReport {
  const cards = scenarios.map((s) =>
    scoreExperiment(s.experiment, s.goal, { thresholds, provenanceResolved: s.provenanceResolved }),
  );
  const passed = cards.filter((c) => c.pass).length;
  return {
    cards,
    passRate: cards.length ? passed / cards.length : 0,
    meanOverall: cards.length ? cards.reduce((s, c) => s + c.overall, 0) / cards.length : 0,
  };
}
