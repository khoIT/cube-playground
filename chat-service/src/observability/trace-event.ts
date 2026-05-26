/**
 * Phase 05 — typed event surface for the unified turn tracer.
 *
 * The existing `ObserverHooks` interface (composite-observer.ts) carries the
 * same signals via 5 different method names. The TraceEvent union below is
 * the single shape a `TraceSink.emit()` consumes, so a sink no longer needs
 * to implement 5 methods to subscribe to the firehose — it switches on
 * `event.kind` instead.
 *
 * Field names are pinned: changing them is a breaking sink-API change. New
 * kinds may be added safely (sinks already default-discard unknowns).
 *
 * Mapping to existing ObserverHooks:
 *   { kind: 'llm_call' }             → onLlmCall
 *   { kind: 'tool_invocation' }      → onToolInvocation
 *   { kind: 'sdk_event' }            → onSdkEvent
 *   { kind: 'turn_finalized' }       → onTurnFinalized
 *   { kind: 'permission_decision' } → onPermissionDecision
 *   { kind: 'turn_aborted' }         → NEW — phase 04 abort signal
 */

import type {
  LlmCallEvent,
  ToolInvocationEvent,
  SdkEventRecord,
  TurnFinalizedEvent,
  PermissionDecisionEvent,
} from './observer-types.js';

export interface TraceEventLlmCall {
  kind: 'llm_call';
  payload: LlmCallEvent;
}

export interface TraceEventToolInvocation {
  kind: 'tool_invocation';
  payload: ToolInvocationEvent;
}

export interface TraceEventSdk {
  kind: 'sdk_event';
  payload: SdkEventRecord;
}

export interface TraceEventTurnFinalized {
  kind: 'turn_finalized';
  payload: TurnFinalizedEvent;
}

export interface TraceEventPermissionDecision {
  kind: 'permission_decision';
  payload: PermissionDecisionEvent;
}

export interface TraceEventTurnAborted {
  kind: 'turn_aborted';
  payload: {
    turnId: string;
    reason: 'user_cancel' | 'timeout' | 'server_error';
    message?: string;
    at: number;
  };
}

export type TraceEvent =
  | TraceEventLlmCall
  | TraceEventToolInvocation
  | TraceEventSdk
  | TraceEventTurnFinalized
  | TraceEventPermissionDecision
  | TraceEventTurnAborted;

/**
 * Sinks subscribe by implementing `emit`. Per-sink exceptions are swallowed
 * by the tracer so one bad sink doesn't break the others.
 */
export interface TraceSink {
  /** Sink name used in error logs to identify the failing implementation. */
  readonly name: string;
  emit(event: TraceEvent): void;
}
