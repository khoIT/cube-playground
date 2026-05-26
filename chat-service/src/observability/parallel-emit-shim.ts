/**
 * Parallel-emit shim — de-risks the observability cutover.
 *
 * The legacy dispatch (claude-runner.ts inline emit* calls → ObserverHooks)
 * and the new TurnTracer both consume the same SDK message stream and should
 * produce a byte-identical sequence of observer callbacks. "Should" is not
 * "verified": off-by-one sequencing, dropped edge messages, or a renamed field
 * would silently corrupt a write-path that can't be backfilled.
 *
 * This shim runs both paths on the same live traffic and diffs their output:
 *   - RecordingObserver captures what the legacy path dispatches (added as a
 *     no-op extra observer on the composite — it never writes anywhere).
 *   - RecordingSink captures what a shadow TurnTracer dispatches (its only
 *     sink — the shadow tracer never touches the DB or Langfuse).
 *   - diffRecordings() compares the two, ignoring inherently-nondeterministic
 *     fields (independent Date.now() reads, per-denial uuid).
 *
 * Once a soak shows zero structural diffs across representative traffic, the
 * cutover can delete the legacy inline dispatch with confidence.
 */

import type {
  ObserverHooks,
  LlmCallEvent,
  ToolInvocationEvent,
  SdkEventRecord,
  TurnFinalizedEvent,
  PermissionDecisionEvent,
} from './observer-types.js';
import type { ObserverExtensions } from './sinks/observer-sink-adapter.js';
import type { TraceEvent, TraceSink, TraceEventTurnAborted } from './trace-event.js';

/** One captured dispatch, normalized to the TraceEvent shape for comparison. */
export interface RecordedEvent {
  kind: TraceEvent['kind'];
  payload: Record<string, unknown>;
}

/**
 * Fields derived from a fresh wall-clock read or a random uuid at emit time.
 * Both paths compute these independently, so they legitimately differ even
 * when the dispatch is identical. Excluded from the structural diff; surfaced
 * separately as informational timing deltas.
 */
const VOLATILE_KEYS = ['latencyMs', 'startedAt', 'endedAt', 'at', 'id'] as const;

/** Captures the legacy path's observer callbacks into an in-memory array. */
export class RecordingObserver implements ObserverHooks, ObserverExtensions {
  readonly events: RecordedEvent[] = [];

  onLlmCall(payload: LlmCallEvent): void {
    this.push('llm_call', payload);
  }
  onToolInvocation(payload: ToolInvocationEvent): void {
    this.push('tool_invocation', payload);
  }
  onSdkEvent(payload: SdkEventRecord): void {
    this.push('sdk_event', payload);
  }
  onTurnFinalized(payload: TurnFinalizedEvent): void {
    this.push('turn_finalized', payload);
  }
  onPermissionDecision(payload: PermissionDecisionEvent): void {
    this.push('permission_decision', payload);
  }
  onTurnAborted(payload: TraceEventTurnAborted['payload']): void {
    this.push('turn_aborted', payload);
  }

  private push(kind: TraceEvent['kind'], payload: unknown): void {
    this.events.push({ kind, payload: payload as Record<string, unknown> });
  }
}

/** Captures the shadow TurnTracer's TraceEvents into an in-memory array. */
export class RecordingSink implements TraceSink {
  readonly name = 'parallel-emit-recording';
  readonly events: RecordedEvent[] = [];

  emit(event: TraceEvent): void {
    this.events.push({ kind: event.kind, payload: event.payload as Record<string, unknown> });
  }
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/** Strip volatile keys from a single payload (shallow — the volatile fields are all top-level). */
function stripVolatile(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if ((VOLATILE_KEYS as readonly string[]).includes(k)) continue;
    out[k] = v;
  }
  return out;
}

/** Stable stringify so key order can't produce a false mismatch. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (val as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return val;
  });
}

export interface RecordingMismatch {
  index: number;
  reason: 'kind' | 'payload' | 'missing_in_legacy' | 'missing_in_shadow';
  legacy?: { kind: string; payload: Record<string, unknown> };
  shadow?: { kind: string; payload: Record<string, unknown> };
}

export interface DiffResult {
  match: boolean;
  legacyCount: number;
  shadowCount: number;
  /** Per-kind counts in the legacy path (for at-a-glance coverage). */
  kindCounts: Record<string, number>;
  mismatches: RecordingMismatch[];
  /** Max absolute latencyMs delta seen across paired llm_call/tool_invocation events. */
  maxLatencyDeltaMs: number;
}

/**
 * Compare two recordings position-by-position. Equal iff same length, same
 * kind at each index, and structurally-equal payloads after stripping volatile
 * fields. Timing deltas are computed but never cause a mismatch.
 */
export function diffRecordings(legacy: RecordedEvent[], shadow: RecordedEvent[]): DiffResult {
  const mismatches: RecordingMismatch[] = [];
  const kindCounts: Record<string, number> = {};
  let maxLatencyDeltaMs = 0;
  const max = Math.max(legacy.length, shadow.length);

  for (let i = 0; i < max; i += 1) {
    const l = legacy[i];
    const s = shadow[i];
    if (l) kindCounts[l.kind] = (kindCounts[l.kind] ?? 0) + 1;

    if (!l) {
      mismatches.push({ index: i, reason: 'missing_in_legacy', shadow: s });
      continue;
    }
    if (!s) {
      mismatches.push({ index: i, reason: 'missing_in_shadow', legacy: l });
      continue;
    }
    if (l.kind !== s.kind) {
      mismatches.push({ index: i, reason: 'kind', legacy: l, shadow: s });
      continue;
    }
    const lNorm = stripVolatile(l.payload);
    const sNorm = stripVolatile(s.payload);
    if (stableStringify(lNorm) !== stableStringify(sNorm)) {
      mismatches.push({ index: i, reason: 'payload', legacy: { kind: l.kind, payload: lNorm }, shadow: { kind: s.kind, payload: sNorm } });
      continue;
    }
    // structurally identical — record the timing delta for the informational report
    const lLat = l.payload['latencyMs'];
    const sLat = s.payload['latencyMs'];
    if (typeof lLat === 'number' && typeof sLat === 'number') {
      maxLatencyDeltaMs = Math.max(maxLatencyDeltaMs, Math.abs(lLat - sLat));
    }
  }

  return {
    match: mismatches.length === 0,
    legacyCount: legacy.length,
    shadowCount: shadow.length,
    kindCounts,
    mismatches,
    maxLatencyDeltaMs,
  };
}
