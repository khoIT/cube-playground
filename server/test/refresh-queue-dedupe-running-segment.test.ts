/**
 * Refresh-queue dedupe against the IN-FLIGHT segment.
 *
 * The drain loop removes an id from `pending` before awaiting its refresh, so
 * the pending Set alone never deduped a re-enqueue of the segment currently
 * being refreshed — a manual "Refresh" click during the long card-pass tail
 * stacked a full redundant cohort+cards refresh right behind the running one.
 * enqueueRefresh must no-op for the running id while still accepting other ids
 * and accepting the same id again once its refresh has finished.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Controllable refreshSegment: each call returns a promise we settle manually
// so the test can hold a segment "in flight" while enqueueing more work.
const calls: string[] = [];
let release: (() => void)[] = [];
vi.mock('../src/jobs/refresh-segment.js', () => ({
  refreshSegment: (id: string) => {
    calls.push(id);
    return new Promise<void>((resolve) => {
      release.push(resolve);
    });
  },
}));

import { enqueueRefresh, currentlyProcessing, queueSize } from '../src/jobs/refresh-queue.js';

const tick = () => new Promise<void>((r) => setImmediate(r));

beforeEach(() => {
  calls.length = 0;
  release = [];
});

describe('enqueueRefresh dedupe of the running segment', () => {
  it('ignores a re-enqueue of the segment currently refreshing, accepts others, and allows re-run after completion', async () => {
    const drain = enqueueRefresh('seg-a');
    await tick();
    expect(currentlyProcessing()).toBe('seg-a');
    expect(calls).toEqual(['seg-a']);

    // Redundant click while seg-a is mid-refresh: must not queue a second pass.
    void enqueueRefresh('seg-a');
    expect(queueSize()).toBe(0);

    // A different segment still queues normally behind the running one.
    void enqueueRefresh('seg-b');
    expect(queueSize()).toBe(1);

    release[0]!(); // finish seg-a
    await tick();
    expect(calls).toEqual(['seg-a', 'seg-b']); // exactly one seg-a pass

    release[1]!(); // finish seg-b
    await drain;
    expect(currentlyProcessing()).toBeNull();

    // After completion the same id is enqueueable again (not permanently barred).
    const drain2 = enqueueRefresh('seg-a');
    await tick();
    expect(calls).toEqual(['seg-a', 'seg-b', 'seg-a']);
    release[2]!();
    await drain2;
  });
});
