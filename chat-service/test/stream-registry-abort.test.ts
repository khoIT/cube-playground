/**
 * Phase 04 — stream-registry abort path unit tests.
 *
 * Covers:
 *   - abort() returns true when a turn is running + controller present
 *   - abort() returns false on unknown turn / finished turn (race: cancel
 *     arrived after natural completion)
 *   - controller.signal becomes aborted with the reason captured on the entry
 *   - abort() is idempotent (a second call is a no-op)
 */

import { describe, it, expect } from 'vitest';
import { createStreamRegistry } from '../src/core/stream-registry.js';

function makeRegistry() {
  return createStreamRegistry({
    ringSize: 50,
    maxTurns: 5,
    ttlMs: 60_000,
    sweepIntervalMs: 60_000,
  });
}

describe('stream-registry — abort', () => {
  it('returns true and aborts the controller on a running turn', () => {
    const reg = makeRegistry();
    const controller = new AbortController();
    reg.register('t1', 's1', controller);

    const ok = reg.abort('t1', 'user_cancel');
    expect(ok).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(reg.get('t1')?.abortReason).toBe('user_cancel');
    reg.dispose();
  });

  it('returns false for an unknown turnId', () => {
    const reg = makeRegistry();
    expect(reg.abort('nope', 'user_cancel')).toBe(false);
    reg.dispose();
  });

  it('returns false for a finished turn (race: cancel after done)', () => {
    const reg = makeRegistry();
    const controller = new AbortController();
    reg.register('t1', 's1', controller);
    reg.finish('t1', 'done');
    expect(reg.abort('t1', 'user_cancel')).toBe(false);
    // Controller was not touched.
    expect(controller.signal.aborted).toBe(false);
    reg.dispose();
  });

  it('captures timeout reason distinctly from user_cancel', () => {
    const reg = makeRegistry();
    const controller = new AbortController();
    reg.register('t1', 's1', controller);
    reg.abort('t1', 'timeout');
    expect(reg.get('t1')?.abortReason).toBe('timeout');
    reg.dispose();
  });

  it('is idempotent — a second abort is a no-op (no error)', () => {
    const reg = makeRegistry();
    const controller = new AbortController();
    reg.register('t1', 's1', controller);
    reg.abort('t1', 'user_cancel');
    expect(() => reg.abort('t1', 'user_cancel')).not.toThrow();
    reg.dispose();
  });

  it('works without a controller (legacy register signature)', () => {
    const reg = makeRegistry();
    reg.register('t1', 's1'); // no controller
    // Abort still succeeds (sets abortReason) but signal flow is degraded.
    expect(reg.abort('t1', 'user_cancel')).toBe(true);
    expect(reg.get('t1')?.abortReason).toBe('user_cancel');
    reg.dispose();
  });
});
