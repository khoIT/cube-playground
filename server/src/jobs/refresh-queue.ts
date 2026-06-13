/**
 * In-memory FIFO queue for segment refreshes.
 * Single-instance dev-tool semantics: one tick at a time, no overlap.
 * Returns a promise that resolves when the queue is fully drained.
 */

import { refreshSegment, type RefreshSource } from './refresh-segment.js';

const pending = new Set<string>();
/** Who asked for each pending refresh — recorded into the run history so an
 *  operator can tell a manual re-run from the hourly cron pass. A re-enqueue
 *  of a queued id overwrites (last requester wins). */
const pendingSource = new Map<string, RefreshSource>();
let processing = false;
let processingId: string | null = null;
let drainPromise: Promise<void> | null = null;

export function enqueueRefresh(segmentId: string, source: RefreshSource = 'manual'): Promise<void> {
  // The drain loop removes an id from `pending` before awaiting its refresh,
  // so the Set alone doesn't dedupe against the IN-FLIGHT segment — re-adding
  // it here would schedule a redundant back-to-back refresh of the exact
  // cohort still being computed.
  if (segmentId === processingId) {
    return drainPromise ?? Promise.resolve();
  }
  pending.add(segmentId);
  pendingSource.set(segmentId, source);
  return startDrain();
}

export function isProcessing(): boolean {
  return processing;
}

export function queueSize(): number {
  return pending.size;
}

/** Segment ids waiting behind the in-flight one (insertion order). The ops
 *  monitor shows these as "Queued" so a deep queue isn't mistaken for stalled
 *  segments that merely display "Due". */
export function pendingIds(): string[] {
  return [...pending];
}

/** The segment id currently being refreshed by the drain loop, or null when
 *  idle. The wedge watchdog consults this so it never reaps a row that is
 *  genuinely in-flight (a slow multi-million-uid refresh can outrun the wedge
 *  threshold while still legitimately running). */
export function currentlyProcessing(): string | null {
  return processingId;
}

function startDrain(): Promise<void> {
  if (drainPromise) return drainPromise;
  drainPromise = drain().finally(() => {
    drainPromise = null;
  });
  return drainPromise;
}

async function drain(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (pending.size > 0) {
      const next = pending.values().next().value as string | undefined;
      if (next == null) break;
      pending.delete(next);
      const source = pendingSource.get(next) ?? 'manual';
      pendingSource.delete(next);
      processingId = next;
      try {
        await refreshSegment(next, source);
      } catch {
        // refresh-segment handles its own errors; never throw past the queue.
      } finally {
        processingId = null;
      }
    }
  } finally {
    processing = false;
    processingId = null;
  }
}
