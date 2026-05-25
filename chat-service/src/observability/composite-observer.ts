/**
 * composite-observer.ts — multicasts ObserverHooks events to N observers.
 *
 * Each observer is called independently; an exception from one observer
 * never prevents subsequent observers from receiving the event (defense in
 * depth). The composite itself never throws.
 *
 * Usage:
 *   const observer = buildCompositeObserver([recorder, tracer]);
 *   // pass to claudeRunner.run({ ..., observer })
 */

import type { ObserverHooks, LlmCallEvent, ToolInvocationEvent, SdkEventRecord } from './observer-types.js';

/**
 * Wraps a single observer method call; logs and swallows any thrown error
 * so the composite's iteration continues to subsequent observers.
 */
function safeCall(fn: () => void, label: string): void {
  try {
    fn();
  } catch (err) {
    console.warn(`[CompositeObserver] ${label} threw (swallowed):`, err);
  }
}

/**
 * Returns an ObserverHooks that multicasts each event to every observer in
 * `observers` (in order). Per-observer exceptions are swallowed.
 *
 * Empty list → all methods are no-ops (zero allocations at call time).
 */
export function buildCompositeObserver(observers: ObserverHooks[]): ObserverHooks {
  return {
    onLlmCall(ev: LlmCallEvent): void {
      for (const o of observers) {
        safeCall(() => o.onLlmCall(ev), 'onLlmCall');
      }
    },

    onToolInvocation(inv: ToolInvocationEvent): void {
      for (const o of observers) {
        safeCall(() => o.onToolInvocation(inv), 'onToolInvocation');
      }
    },

    onSdkEvent(ev: SdkEventRecord): void {
      for (const o of observers) {
        safeCall(() => o.onSdkEvent(ev), 'onSdkEvent');
      }
    },
  };
}
