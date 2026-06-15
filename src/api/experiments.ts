/**
 * Experiments API client — the persisted experiment behind the advisor's live
 * monitoring board. Create a draft from a segment, freeze the split, then poll
 * the scorecard for real treatment-vs-hold-out outcomes.
 */

import { apiFetch } from './api-client';

export type ExperimentStatus = 'draft' | 'running' | 'completed' | 'archived';
export type PrimaryMetric = 'gross_payment_rate' | 'sessions_per_week';
export type Arm = 'treatment' | 'control';

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

export interface ArmCounts {
  treatment: number;
  control: number;
}

/** A registry row plus its frozen arm counts + cohort name — what the list and
 *  get endpoints return. `segmentName` is null if the cohort was deleted. */
export type ExperimentSummary = Experiment & { arms: ArmCounts; segmentName: string | null };

export interface CreateExperimentInput {
  game: string;
  name: string;
  segmentId: string;
  hypothesis?: string;
  splitPct?: number;
  primaryMetric?: PrimaryMetric;
  windowDays?: number;
  cohortCap?: number;
}

export interface AssignmentResult {
  experimentId: string;
  treatment: number;
  control: number;
  total: number;
  capped: boolean;
  assignedAt: string;
}

export interface ArmOutcome {
  arm: Arm;
  assigned: number;
  payers: number;
  grossVnd: number;
  txns: number;
}

export interface OutcomeSeriesPoint {
  date: string;
  treatmentGrossVnd: number;
  controlGrossVnd: number;
}

export interface ProportionTest {
  treatmentRate: number;
  controlRate: number;
  liftPp: number;
  ci95: [number, number];
  pValue: number;
  significant: boolean;
}

export interface MeanTest {
  treatmentMean: number;
  controlMean: number;
  liftAbs: number;
  liftPct: number | null;
}

export interface Scorecard {
  repayRate: ProportionTest;
  grossPerMember: MeanTest;
  verdict: 'win' | 'inconclusive' | 'flat';
}

export interface ScorecardResponse {
  experimentId: string;
  assignedAt: string;
  windowDays: number;
  primaryMetric: PrimaryMetric;
  currencies: string[];
  arms: ArmOutcome[];
  series: OutcomeSeriesPoint[];
  scorecard: Scorecard;
}

/** List experiments for a game, newest first; optionally only one segment's. */
export async function listExperiments(
  game: string,
  segmentId?: string,
): Promise<ExperimentSummary[]> {
  const qs = new URLSearchParams({ game });
  if (segmentId) qs.set('segment', segmentId);
  const res = await apiFetch<{ experiments: ExperimentSummary[] }>(`/api/experiments?${qs}`);
  return res.experiments;
}

/** Fetch one experiment with its frozen arm counts + cohort name. */
export async function getExperiment(id: string): Promise<ExperimentSummary> {
  const res = await apiFetch<{ experiment: Experiment; arms: ArmCounts; segmentName: string | null }>(
    `/api/experiments/${encodeURIComponent(id)}`,
  );
  return { ...res.experiment, arms: res.arms, segmentName: res.segmentName };
}

export async function createExperiment(input: CreateExperimentInput): Promise<Experiment> {
  const res = await apiFetch<{ experiment: Experiment }>('/api/experiments', {
    method: 'POST',
    body: input,
  });
  return res.experiment;
}

/**
 * Freeze the split. `resync: true` re-freezes an already-running experiment
 * against the cohort segment's CURRENT membership, restarting the outcome
 * window (destructive — the prior arms are discarded).
 */
export async function assignExperiment(
  id: string,
  opts?: { resync?: boolean },
): Promise<AssignmentResult> {
  const res = await apiFetch<{ assignment: AssignmentResult }>(
    `/api/experiments/${encodeURIComponent(id)}/assign`,
    { method: 'POST', body: { resync: opts?.resync === true } },
  );
  return res.assignment;
}

export async function fetchScorecard(id: string): Promise<ScorecardResponse> {
  return apiFetch<ScorecardResponse>(`/api/experiments/${encodeURIComponent(id)}/scorecard`);
}
