/**
 * Types for the Advisor lever-mapping → prioritization pass.
 *
 * An ExperimentCandidate is produced by ranking Opportunity[] against:
 *   - lever feasibility (CS-actuated today = feasible; push/pricing = infeasible)
 *   - statistical power (can the segment detect the expected lift?)
 *   - monetary estimate (expected incremental ₫)
 *   - expected-effect prior from the Treatment-Effect Library
 *
 * Every expected-effect carries a confidence label so the Advisor UI can render
 * "assumption" priors distinctly from empirically-measured ones.
 */

// ─── Lever reference ─────────────────────────────────────────────────────────

/** A concrete intervention tied to a playbook (or a synthetic lever if no playbook). */
export interface LeverRef {
  /** Lever family name, e.g. "win-back", "spend-drop-recovery". */
  family: string;
  /**
   * Actuator channel available today: 'cs' = CS team can deliver via the
   * VIP Care console; 'system' = requires automated push/pricing not yet built.
   */
  actuator: 'cs' | 'system';
  /** Human description of the specific intervention. */
  description: string;
}

// ─── Feasibility ─────────────────────────────────────────────────────────────

/**
 * Three-way verdict on whether the platform can deliver the lever today.
 *
 * - feasible         — CS-actuated, deliverable now.
 * - nearest-feasible — best lever needs infra we don't have; the `substitute`
 *                      names the closest CS-deliverable alternative.
 * - infeasible       — no CS path to this outcome at all today.
 */
export type FeasibilityStatus = 'feasible' | 'nearest-feasible' | 'infeasible';

export interface FeasibilityVerdict {
  status: FeasibilityStatus;
  /** Lever being assessed. */
  lever: LeverRef;
  /**
   * Why the lever is blocked (infeasible/nearest-feasible cases).
   * E.g. "price-anchored offer requires pricing engine not built yet".
   */
  why?: string;
  /**
   * The nearest CS-deliverable substitute when status='nearest-feasible'.
   * E.g. "CS-delivered offer: manual promo via VIP console".
   */
  substitute?: string;
}

// ─── Power verdict ───────────────────────────────────────────────────────────

/** Statistical power verdict from the MDE check. */
export type PowerStatus = 'powered' | 'underpowered';

export interface PowerVerdict {
  status: PowerStatus;
  /** Minimum detectable effect as an absolute percentage point (e.g. 4.2 = 4.2 pp). */
  mde: number;
  /**
   * Human detail: "N=2400, reachable=78%, 14d window → detectable ≥4.2 pp at 80% power".
   * Surfaced in the Advisor UI cards for transparency.
   */
  detail: string;
}

// ─── Expected effect prior ────────────────────────────────────────────────────

/**
 * Confidence tiers, ordered by evidentiary strength:
 * - measured    = own completed experiment (highest trust)
 * - benchmark   = cross-segment or cross-game result from our library
 * - assumption  = game-ops default / industry prior (lowest trust)
 *
 * The Advisor UI MUST render 'assumption' distinctly (e.g. italic label, lower opacity)
 * so downstream decisions are never misinformed about prior strength.
 */
export type EffectConfidence = 'measured' | 'benchmark' | 'assumption';

/** Expected treatment effect on the target factor. */
export interface EffectPrior {
  /** Absolute effect size as a fraction (0.06 = +6 pp). */
  value: number;
  confidence: EffectConfidence;
  /**
   * Free-text provenance. E.g. "game-ops default" / "cfm_vn win-back experiment
   * Q1-2025 (N=820, outcome=kpi_met)" / "industry benchmark (Liftoff 2023)".
   */
  source: string;
}

// ─── Monetary estimate ────────────────────────────────────────────────────────

export interface MoneyEstimate {
  /**
   * Expected incremental revenue in VND (null when ₫/unit is not yet agreed).
   * When null, ranking falls back to effect × addressableN × confidence weight.
   */
  incrementalVnd: number | null;
  /** ₫ revenue per addressed unit (null when TBD). */
  perUnitVnd: number | null;
  /** Human note, e.g. "TBD — ₫/unit pending" or "₫850k ARPU30d × 0.06 effect × 2400 N". */
  note: string;
  /** Currency code (default VND; jus may use USD for cross-currency). */
  currency?: string;
}

// ─── Top-level experiment candidate ──────────────────────────────────────────

/**
 * A single ranked experiment candidate produced by the candidate ranker.
 *
 * All numeric inputs to `score` are preserved so the Advisor UI can show the
 * workings without re-computing. `rankReason` is the human-readable form.
 */
export interface ExperimentCandidate {
  /** Stable ID: `${opportunityFactor}::${lever.family}`. */
  id: string;
  /** Factor key from the originating Opportunity (e.g. "lifespan"). */
  opportunityFactor: string;
  lever: LeverRef;
  /** Linked playbook ID from the VIP-Care registry (null if no direct match). */
  playbookId?: string;
  feasibility: FeasibilityVerdict;
  power: PowerVerdict;
  expectedEffect: EffectPrior;
  money: MoneyEstimate;
  /**
   * Composite score used to rank candidates (higher = better).
   * Formula: addressableN × effect × valuePerUnit × feasibilityWeight × confidenceWeight ÷ effort.
   * When ₫/unit TBD, valuePerUnit defaults to 1 so relative ordering is preserved.
   */
  score: number;
  /**
   * One-line rationale for this rank position.
   * E.g. "Win-back (+6pp assumed): N=2400 powered, score=144. Prior=assumption."
   */
  rankReason: string;
  /**
   * Phrased experiment hypotheses (3 strings) produced by the LLM phrasing pass.
   * Populated lazily — absent until phraseHypotheses() is called.
   * LLM proposes WORDING only; ordering and numbers come from the ranker.
   */
  hypotheses?: string[];
  /**
   * Lens evidence behind this candidate's factor — the originating lens's Cube
   * query. Attached by recommend() (not the ranker) so the draft can carry a
   * re-runnable Playground link for its Opportunity. Absent when no lens carried
   * provenance for the factor.
   */
  evidenceLink?: import('./diagnosis-types.js').PlaygroundLink;
}

// ─── Ranker input bundle ──────────────────────────────────────────────────────

/** Everything the ranker needs for one opportunity. */
export interface RankerInput {
  opportunity: import('./diagnosis-types.js').Opportunity;
  /** Total addressable member count for this scope. */
  addressableN: number;
  /** Fraction of addressableN reachable by the lever (0–1). */
  reachablePct: number;
  /** Experiment window in days. */
  windowDays: number;
  /**
   * Baseline rate for MDE computation (e.g. fraction who converted).
   * Use factor.value / addressableN when available; fall back to a game default.
   */
  baselineRate: number;
  /** Optional override: ₫ revenue per user per period. */
  valuePerUnitVnd?: number;
  /** Game ID — used to look up Library priors. */
  gameId: string;
}
