/**
 * Core types for the Optimization Advisor diagnosis engine.
 *
 * A Diagnosis triangulates N descriptive lenses over a segment or game scope
 * and synthesizes ranked Opportunities — each carrying confidence = # lenses
 * that agree the underlying Factor is weak.
 *
 * Provenance is REQUIRED on every LensResult so the Advisor UI can reconstruct the
 * Cube query in the Playground for drilling into any evidence point.
 */

// ─── Scope ────────────────────────────────────────────────────────────────────

/** A predicate-defined segment as the subject of diagnosis. */
export interface SegmentRef {
  kind: 'segment';
  /** Segment primary-key UUID. */
  segmentId: string;
  /** Game the segment belongs to (e.g. "cfm_vn"). */
  gameId: string;
}

/** The full game population (no predicate filter) as the subject. */
export interface GameRef {
  kind: 'game';
  gameId: string;
}

export type ScopeRef = SegmentRef | GameRef;

// ─── Goal tree ────────────────────────────────────────────────────────────────

/** A measurable factor in the goal tree. */
export interface Factor {
  /** Canonical key used to join across lenses and opportunities (e.g. "payers"). */
  key: string;
  /** Human-readable label for display ("Payer Count"). */
  label: string;
  /** Observed value for this scope (null = unavailable). */
  value: number | null;
  /** Population baseline value (null = unavailable). */
  baseline: number | null;
  /** True when this factor is below the acceptable threshold vs baseline. */
  weak: boolean;
  /** Display unit hint ("₫", "%", "days", "sessions/wk"). */
  unit?: string;
}

/**
 * One goal tree with its decomposed factors.
 * Revenue: payers × ARPPU × lifespan (growth accounting).
 * Engagement: session_freq × session_length × lifespan (leading indicator).
 */
export interface GoalTree {
  goal: 'revenue' | 'engagement';
  factors: Factor[];
  /** True when the tree could not be fully populated (e.g. missing measures). */
  degraded?: boolean;
  /** Human note explaining any degradation. */
  degradedNote?: string;
}

// ─── Opportunities ────────────────────────────────────────────────────────────

/** A ranked uplift opportunity derived from synthesis. */
export interface Opportunity {
  /** Factor key this opportunity targets (e.g. "lifespan"). */
  factor: string;
  /** Gap as a percentage of baseline (positive = below baseline). */
  gapPct: number;
  /** Absolute gap in the factor's native unit. */
  gapValue: number;
  /**
   * Suggested intervention levers (populated by the lever-mapping pass).
   * Empty in v1 — included in type so the lever-mapping pass can fill without a type change.
   */
  levers?: string[];
  /**
   * Confidence score = count of lenses (by id) that independently corroborate
   * this factor as weak. Correlated lenses (e.g. Level and percentile-of-Level)
   * intentionally count as ONE signal — see lens-synthesis.ts for the
   * de-duplication rule.
   */
  confidence: number;
  /** IDs of lenses that agree this factor is weak. */
  agreeingLenses: number[];
}

// ─── Lens results ─────────────────────────────────────────────────────────────

/**
 * Everything needed to reconstruct the evidence query in the Playground.
 * Provenance is required — every LensResult must carry one so the Advisor UI can
 * render live drill-through without re-executing.
 */
export interface PlaygroundLink {
  /** Logical cube name (without game prefix). */
  cube?: string;
  /** Measure members queried. */
  measures: string[];
  /** Dimension members queried (optional). */
  dimensions?: string[];
  /** Filter array (serializable Cube filter objects). */
  filters?: unknown[];
  /**
   * Human-readable source label for display (e.g.
   * "billing_lifetime + mf_users / cfm_vn").
   */
  source: string;
  /** Row count returned — helps readers gauge data density. */
  rows?: number;
}

/** Verdict from a single lens on one or more factors. */
export type LensVerdict = 'weak' | 'ok' | 'strong' | 'inconclusive';

/** Full result of running one lens. */
export interface LensResult {
  /** Lens identifier matching the lens table (1–9). */
  id: number;
  /** Short lens name (e.g. "Level vs Population"). */
  name: string;
  /** Overall verdict for the primary factor this lens inspects. */
  verdict: LensVerdict;
  /**
   * The factor key this verdict is attributed to — lets synthesis join lens
   * verdicts to goal-tree factors.
   */
  factor?: string;
  /** Raw inputs / computed values used; kept for debugging / UI rendering. */
  inputs: Record<string, unknown>;
  /** One-line description of what was computed (e.g. "percentile rank = P12"). */
  method: string;
  /** Required: Cube query evidence link. */
  provenance: PlaygroundLink;
}

// ─── Top-level Diagnosis ──────────────────────────────────────────────────────

/** Full diagnosis result returned by diagnose(). */
export interface Diagnosis {
  goalTrees: GoalTree[];
  opportunities: Opportunity[];
  /** All lens results (sync + any lazy lenses that were requested). */
  lenses: LensResult[];
}

// ─── Engine input ─────────────────────────────────────────────────────────────

/** Input to the diagnosis engine. */
export interface DiagnosisInput {
  scope: ScopeRef;
  goal: 'revenue' | 'engagement' | 'both';
  /** Reference date — threads through all computations; never call new Date() inside. */
  asOf: Date;
  options?: {
    /**
     * Lens IDs to include. Omit for sync-only (1–4). Pass [1,2,3,4,5,6,7,8,9]
     * to run all. Lenses 5–9 are lazy (expensive).
     */
    lenses?: number[];
  };
}
