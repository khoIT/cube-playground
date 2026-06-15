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

import { apiFetch, buildRequestHeaders } from './api-client';

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

/** The five causal-chain slots, each self-contained (mirror handoff-scaffolder.ts). */
export interface ExperimentBlueprint {
  opportunity: string;
  target: string;
  cause: string;
  lever: string;
  proof: string;
}

/** Pre-registered "what to look for" rule (mirror handoff-scaffolder.ts). */
export interface ReadoutRule {
  primaryMetric: string;
  mde: number;
  horizonDays: number;
  holdoutPct: number;
  decisionRule: string;
}

// ─── Quality scorecard (mirror agent/experiment-quality-score.ts) ─────────────

export type QualityDimension = 'power' | 'feasibility' | 'materiality' | 'provenance' | 'goalFit';

export interface DimensionScore {
  dimension: QualityDimension;
  /** Continuous 0–1 score. */
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
  /** The opportunity factor this experiment attacks. */
  opportunityFactor: string;
  /** Self-contained 5-slot causal chain. */
  blueprint: ExperimentBlueprint;
  /** Pre-registered readout rule. */
  readout: ReadoutRule;
  /** Quality scorecard; the Decide gate hard-stops on a failing critical dim. */
  scorecard?: ExperimentScorecard;
  /** Recorded justification when a manager advances past a failing gate. */
  gateOverride?: { reason: string; at: string };
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

/** List scaffolded drafts for a segment (most recent first). */
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

// ─── Interactive agent (Drive) — SSE turn stream ──────────────────────────────

export type AgentMode = 'drive' | 'steer' | 'explore';

export type AgentStopReason = 'end_turn' | 'max_turns' | 'budget' | 'timeout' | 'aborted' | 'error';

export type AgentErrorCode =
  | 'oauth_missing'
  | 'oauth_unavailable'
  | 'max_turns'
  | 'budget_exceeded'
  | 'timeout'
  | 'aborted'
  | 'tool_denied'
  | 'sdk_error';

/** Normalized runtime events streamed by POST /api/advisor/agent/turn (mirror agent-types.ts). */
export type AgentRuntimeEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'assistant_delta'; text: string }
  | { type: 'tool_call'; tool: string; callId?: string }
  | { type: 'tool_result'; tool: string; callId?: string; ok: boolean }
  | { type: 'cost'; usd: number }
  | { type: 'done'; usd: number | null; stopReason: AgentStopReason }
  | { type: 'denied'; tool: string; reason: string }
  | { type: 'error'; code: AgentErrorCode; message: string };

export interface AgentTurnRequest {
  sessionId?: string;
  message: string;
  scope: AdvisorScope;
  goal: AdvisorGoal;
  mode?: AgentMode;
}

/** Handle to an in-flight turn stream. */
export interface AgentTurnStream {
  /** Resolves when the stream ends (done/error/abort). */
  done: Promise<void>;
  /** Abort the in-flight turn (aborts the request; session stays resumable server-side). */
  abort: () => void;
}

/**
 * Open an SSE turn against the advisor agent. Each parsed runtime event is
 * delivered to onEvent in order. The auth/workspace/game headers match apiFetch.
 */
export function streamAgentTurn(
  req: AgentTurnRequest,
  onEvent: (ev: AgentRuntimeEvent) => void,
): AgentTurnStream {
  const controller = new AbortController();
  const done = runAgentStream(req, onEvent, controller.signal);
  return { done, abort: () => controller.abort() };
}

async function runAgentStream(
  req: AgentTurnRequest,
  onEvent: (ev: AgentRuntimeEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/advisor/agent/turn', {
      method: 'POST',
      headers: { ...buildRequestHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    });
  } catch (err) {
    if (signal.aborted) return;
    onEvent({ type: 'error', code: 'sdk_error', message: err instanceof Error ? err.message : String(err) });
    return;
  }

  if (!res.ok || !res.body) {
    // Non-stream error (e.g. 503 oauth_unavailable, 409 turn_in_progress, 400).
    let code: AgentErrorCode = 'sdk_error';
    let message = `request failed (${res.status})`;
    try {
      const body = (await res.json()) as { code?: string; error?: string };
      if (body.code === 'oauth_unavailable') code = 'oauth_unavailable';
      if (body.error) message = body.error;
    } catch {
      /* non-JSON body */
    }
    onEvent({ type: 'error', code, message });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const ev = parseSseFrame(frame);
        if (ev) onEvent(ev);
      }
    }
  } catch (err) {
    if (!signal.aborted) {
      onEvent({ type: 'error', code: 'sdk_error', message: err instanceof Error ? err.message : String(err) });
    }
  }
}

/** Parse one `event: <type>\ndata: <json>` SSE frame into a runtime event. */
function parseSseFrame(frame: string): AgentRuntimeEvent | null {
  const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
  if (!dataLine) return null;
  try {
    return JSON.parse(dataLine.slice(5).trim()) as AgentRuntimeEvent;
  } catch {
    return null;
  }
}
