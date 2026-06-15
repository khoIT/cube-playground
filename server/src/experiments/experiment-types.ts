/**
 * Shared types for the experiment registry, assignment, and scorecard.
 *
 * Outcomes read through the `billing_detail` cube (semantic layer), NOT a raw
 * Trino reader — the cube already encodes the per-game product-code gate and the
 * real-users mf_users semi-join. cfm A49 is VND-only; jus A70 is mixed USD+VND,
 * so the outcome reader normalizes USD→VND at a documented fixed rate.
 */

export type ExperimentStatus = 'draft' | 'running' | 'completed' | 'archived';
export type ExperimentArm = 'treatment' | 'control';
export type PrimaryMetric = 'gross_payment_rate' | 'sessions_per_week';

/** A persisted experiment (SQLite `experiments` row). */
export interface Experiment {
  id: string;
  gameId: string;
  workspace: string;
  name: string;
  hypothesis: string;
  segmentId: string;
  status: ExperimentStatus;
  splitPct: number;
  primaryMetric: PrimaryMetric;
  windowDays: number;
  cohortCap: number;
  assignedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Input to create a draft experiment. */
export interface ExperimentDraftInput {
  gameId: string;
  workspace?: string;
  name: string;
  hypothesis?: string;
  segmentId: string;
  splitPct?: number;
  primaryMetric?: PrimaryMetric;
  windowDays?: number;
  cohortCap?: number;
}

/** Result of freezing a split. */
export interface AssignmentResult {
  experimentId: string;
  treatment: number;
  control: number;
  total: number;
  /** True when the cohort was larger than cohort_cap and was truncated. */
  capped: boolean;
  assignedAt: string;
}

/** Per-arm outcome aggregate over the measurement window (gross VND). */
export interface ArmOutcome {
  arm: ExperimentArm;
  /** Members assigned to the arm. */
  assigned: number;
  /** Members with >=1 gross payment in the window. */
  payers: number;
  /** Sum of gross payments, normalized to VND. */
  grossVnd: number;
  /** Total billing transactions in the window. */
  txns: number;
}

/** One point of the per-arm daily cumulative gross series (for the chart). */
export interface OutcomeSeriesPoint {
  date: string;
  treatmentGrossVnd: number;
  controlGrossVnd: number;
}

/** Raw outcome bundle the reader returns; stats turns it into the scorecard. */
export interface OutcomeBundle {
  arms: ArmOutcome[];
  series: OutcomeSeriesPoint[];
  /** Currencies seen in the window (e.g. ['VND'] for cfm, ['USD','VND'] for jus). */
  currencies: string[];
}
