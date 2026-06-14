/**
 * Typed client for the Optimization Advisor API.
 *
 * Mirrors the server contracts in server/src/advisor/* and server/src/routes/advisor.ts.
 * Types are duplicated here (the web bundle cannot import server code) — keep in
 * sync with the engine types if the server contract changes.
 *
 * Diagnosis is an on-demand live Cube read; on a host without Cube the server
 * returns 502 and these calls reject — the UI renders an honest empty/error
 * state rather than fabricating metrics.
 */

import { apiFetch } from './api-client';

// ─── Scope + goal ───────────────────────────────────────────────────────────

export type AdvisorGoal = 'revenue' | 'engagement' | 'both';

export type AdvisorScope =
  | { kind: 'segment'; segmentId: string; gameId: string }
  | { kind: 'game'; gameId: string };

// ─── Diagnosis shapes (mirror diagnosis-types.ts) ─────────────────────────────

export interface Factor {
  key: string;
  label: string;
  value: number | null;
  baseline: number | null;
  weak: boolean;
  unit?: string;
}

export interface GoalTree {
  goal: 'revenue' | 'engagement';
  factors: Factor[];
  degraded?: boolean;
  degradedNote?: string;
}

export interface Opportunity {
  factor: string;
  gapPct: number;
  gapValue: number;
  levers?: string[];
  confidence: number;
  agreeingLenses: number[];
}

export interface PlaygroundLink {
  cube?: string;
  measures: string[];
  dimensions?: string[];
  filters?: unknown[];
  source: string;
  rows?: number;
}

export type LensVerdict = 'weak' | 'ok' | 'strong' | 'inconclusive';

export interface LensResult {
  id: number;
  name: string;
  verdict: LensVerdict;
  factor?: string;
  inputs: Record<string, unknown>;
  method: string;
  provenance: PlaygroundLink;
}

export interface Diagnosis {
  goalTrees: GoalTree[];
  opportunities: Opportunity[];
  lenses: LensResult[];
}

// ─── Candidate shapes (mirror candidate-types.ts) ─────────────────────────────

export type FeasibilityStatus = 'feasible' | 'nearest-feasible' | 'infeasible';
export type PowerStatus = 'powered' | 'underpowered';
export type EffectConfidence = 'measured' | 'benchmark' | 'assumption';

export interface LeverRef {
  family: string;
  actuator: 'cs' | 'system';
  description: string;
}

export interface FeasibilityVerdict {
  status: FeasibilityStatus;
  lever: LeverRef;
  why?: string;
  substitute?: string;
}

export interface PowerVerdict {
  status: PowerStatus;
  mde: number;
  detail: string;
}

export interface EffectPrior {
  value: number;
  confidence: EffectConfidence;
  source: string;
}

export interface MoneyEstimate {
  incrementalVnd: number | null;
  perUnitVnd: number | null;
  note: string;
  currency?: string;
}

export interface ExperimentCandidate {
  id: string;
  opportunityFactor: string;
  lever: LeverRef;
  playbookId?: string;
  feasibility: FeasibilityVerdict;
  power: PowerVerdict;
  expectedEffect: EffectPrior;
  money: MoneyEstimate;
  score: number;
  rankReason: string;
  hypotheses?: string[];
}

export interface Recommendation {
  diagnosis: Diagnosis;
  candidates: ExperimentCandidate[];
}

// ─── Hand-off draft (mirror handoff-scaffolder.ts) ────────────────────────────

export interface ExperimentArm {
  key: 'treatment' | 'holdout';
  label: string;
  share: number;
}

export interface SafetyGuardrails {
  contactCapPerPlayer: number;
  recentPayerGuardDays: number;
  holdoutMeasured: true;
}

export interface ExperimentDraft {
  draftId: string;
  segmentId: string;
  gameId: string;
  candidateId: string;
  status: 'draft';
  hypothesis: string;
  cohort: { segmentId: string; addressableN: number; reachablePct: number };
  arms: ExperimentArm[];
  windowDays: number;
  power: PowerVerdict;
  expectedEffect: EffectPrior;
  money: MoneyEstimate;
  feasibility: FeasibilityVerdict;
  playbookId?: string;
  delivery: 'cs-queue' | 'external';
  safety: SafetyGuardrails;
}

// ─── Request params ───────────────────────────────────────────────────────────

export interface RecommendParams {
  addressableN: number;
  reachablePct?: number;
  windowDays?: number;
  baselineRate?: number;
  valuePerUnitVnd?: number;
  phrase?: boolean;
  phraseTopN?: number;
}

export interface DiagnoseRequest {
  scope: AdvisorScope;
  goal?: AdvisorGoal;
  asOf?: string;
  lenses?: number[];
}

export type FeedbackAction = 'dismiss' | 'pin';

export interface AdvisorFeedback {
  segmentId: string;
  gameId: string;
  factor: string;
  leverFamily?: string;
  action: FeedbackAction;
  reason: string;
}

export interface AdvisorFeedbackRow extends AdvisorFeedback {
  id: string;
  createdAt: string;
}

// ─── Calls ──────────────────────────────────────────────────────────────────

/** Run the lens engine over a scope + goal. */
export function diagnose(req: DiagnoseRequest): Promise<Diagnosis> {
  return apiFetch<Diagnosis>('/api/advisor/diagnose', { method: 'POST', body: req });
}

/** Diagnose + rank into experiment candidates. */
export function recommend(req: DiagnoseRequest & { params: RecommendParams }): Promise<Recommendation> {
  return apiFetch<Recommendation>('/api/advisor/recommend', { method: 'POST', body: req });
}

/**
 * Scaffold an EDITABLE draft from a candidate (never launches). Returns the
 * draft for inspection.
 */
export function handoff(req: {
  candidate: ExperimentCandidate;
  segmentId: string;
  gameId: string;
  addressableN: number;
  reachablePct?: number;
  windowDays?: number;
  treatmentShare?: number;
}): Promise<ExperimentDraft> {
  return apiFetch<ExperimentDraft>('/api/advisor/handoff', { method: 'POST', body: req });
}

/** List scaffolded drafts for a segment. */
export function listDrafts(segmentId: string): Promise<{ drafts: ExperimentDraft[] }> {
  return apiFetch<{ drafts: ExperimentDraft[] }>(`/api/advisor/drafts/${encodeURIComponent(segmentId)}`);
}

/** Record dismiss/pin feedback with a reason. */
export function sendFeedback(fb: AdvisorFeedback): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/api/advisor/feedback', { method: 'POST', body: fb });
}

/** Read feedback recorded for a segment. */
export function listFeedback(segmentId: string): Promise<{ feedback: AdvisorFeedbackRow[] }> {
  return apiFetch<{ feedback: AdvisorFeedbackRow[] }>(`/api/advisor/feedback/${encodeURIComponent(segmentId)}`);
}
