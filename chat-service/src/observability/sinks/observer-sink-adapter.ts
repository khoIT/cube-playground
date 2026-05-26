/**
 * Phase 05 — bridge an existing `ObserverHooks` implementation (e.g.
 * LlmTraceRecorder, LangfuseTracer) into the new `TraceSink` interface.
 *
 * Once a parallel-emit soak proves the new tracer matches the legacy
 * dispatch path byte-for-byte, the cutover removes `composite-observer.ts`
 * and these adapters become the only call sites for the existing recorders.
 * Until then, the old call path can stay live alongside the new tracer with
 * zero behavioural delta.
 *
 * Unknown TraceEvent kinds (e.g. 'turn_aborted', new in phase 04) are
 * forwarded to a custom hook when the wrapped observer carries one — sinks
 * that don't model the kind silently discard it.
 */

import type { ObserverHooks } from '../observer-types.js';
import type { TraceEvent, TraceSink } from '../trace-event.js';

/**
 * Hook surface for kinds that ObserverHooks doesn't natively model. Used by
 * sinks that want to persist phase-04's abort reason alongside the legacy
 * trace shape.
 */
export interface ObserverExtensions {
  onTurnAborted?: (ev: {
    turnId: string;
    reason: 'user_cancel' | 'timeout' | 'server_error';
    message?: string;
    at: number;
  }) => void;
}

export class ObserverSinkAdapter implements TraceSink {
  readonly name: string;
  private readonly observer: ObserverHooks & ObserverExtensions;

  constructor(name: string, observer: ObserverHooks & ObserverExtensions) {
    this.name = name;
    this.observer = observer;
  }

  emit(event: TraceEvent): void {
    switch (event.kind) {
      case 'llm_call':
        this.observer.onLlmCall(event.payload);
        return;
      case 'tool_invocation':
        this.observer.onToolInvocation(event.payload);
        return;
      case 'sdk_event':
        this.observer.onSdkEvent(event.payload);
        return;
      case 'turn_finalized':
        this.observer.onTurnFinalized?.(event.payload);
        return;
      case 'permission_decision':
        this.observer.onPermissionDecision?.(event.payload);
        return;
      case 'turn_aborted':
        this.observer.onTurnAborted?.(event.payload);
        return;
    }
  }
}
