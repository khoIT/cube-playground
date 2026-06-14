/**
 * Shared types for the in-process advisor agent runtime.
 *
 * The RuntimeEvent union is deliberately decoupled from the SDK's own message
 * shapes: the event-normalizer is the ONLY place that knows about SDKMessage,
 * so the SSE bridge, the UI, and the tests depend on this stable contract
 * rather than on SDK internals (which shift across versions).
 */

import type { ScopeRef, DiagnosisInput } from '../diagnosis-types.js';
import type { WorkspaceCtx } from '../../services/cube-client.js';

export type AdvisorGoal = DiagnosisInput['goal'];

/**
 * How the user is driving this turn — the posture spectrum for business users.
 *  - 'drive'  : the agent investigates the causal chain proactively (the
 *               default after the one-line goal+scope; no prompt-crafting asked
 *               of a non-technical user).
 *  - 'steer'  : a plain-language follow-up nudge that redirects the current
 *               investigation ("focus on login drop, not spend").
 *  - 'explore': the user asks a one-off question and takes the wheel.
 */
export type AgentMode = 'drive' | 'steer' | 'explore';

/** Why a turn stopped — drives the UI's end-state. */
export type AgentStopReason =
  | 'end_turn'
  | 'max_turns'
  | 'budget'
  | 'timeout'
  | 'aborted'
  | 'error';

/** Machine-readable error/guardrail codes surfaced on the `error` event. */
export type AgentErrorCode =
  | 'oauth_missing'
  | 'max_turns'
  | 'budget_exceeded'
  | 'timeout'
  | 'aborted'
  | 'tool_denied'
  | 'sdk_error';

/**
 * Token usage for a turn, normalized from the SDK result's `usage`. All fields
 * optional — the SDK may omit any of them. Cumulated across a run for the audit.
 */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/**
 * Normalized stream of runtime events. The SSE bridge serializes each as
 * `event: <type>\ndata: <json>\n\n`.
 */
export type RuntimeEvent =
  | { type: 'assistant_delta'; text: string }
  // `input` is the agent's own query spec (aggregate, PII-free); optional and
  // additive — existing SSE consumers ignore it. Used by the run-audit recorder.
  | { type: 'tool_call'; tool: string; callId?: string; input?: unknown }
  // `resultText` is a truncated, post-redaction digest of the tool output (also
  // the error text when ok=false). Optional/additive for the audit recorder.
  | { type: 'tool_result'; tool: string; callId?: string; ok: boolean; resultText?: string }
  | { type: 'cost'; usd: number }
  // `usage` + `model` are recorder-only (like tool_call.input): the SSE edge in
  // advisor.ts strips them so the live client wire contract stays unchanged.
  | { type: 'done'; usd: number | null; stopReason: AgentStopReason; usage?: TokenUsage; model?: string }
  | { type: 'denied'; tool: string; reason: string }
  | { type: 'error'; code: AgentErrorCode; message: string };

/** Hard limits enforced at the harness — never trusted to the prompt. */
export interface GuardrailCaps {
  maxTurns: number;
  maxBudgetUsd: number;
  timeoutMs: number;
}

/** What a single client turn carries over the wire. */
export interface TurnRequest {
  sessionId?: string;
  message: string;
  scope: ScopeRef;
  goal: AdvisorGoal;
  mode?: AgentMode;
}

/** Options to stand up a session (one per investigation). */
export interface SessionOpts {
  scope: ScopeRef;
  goal: AdvisorGoal;
  ctx: WorkspaceCtx;
  caps?: Partial<GuardrailCaps>;
  model?: string;
  /** For the audit log only — never enters agent context. */
  owner?: string;
}

/** Public status of a live session (GET endpoint). */
export interface SessionStatus {
  sessionId: string;
  scope: ScopeRef;
  goal: AdvisorGoal;
  turns: number;
  totalCostUsd: number;
  busy: boolean;
  createdAt: number;
  lastActiveAt: number;
}
