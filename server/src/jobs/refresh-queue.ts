/**
 * In-memory FIFO queue for segment refreshes.
 * Single-instance dev-tool semantics: one tick at a time, no overlap.
 * Returns a promise that resolves when the queue is fully drained.
 */

import { refreshSegment } from './refresh-segment.js';

const pending = new Set<string>();
let processing = false;
let drainPromise: Promise<void> | null = null;

export function enqueueRefresh(segmentId: string): Promise<void> {
  pending.add(segmentId);
  return startDrain();
}

export function isProcessing(): boolean {
  return processing;
}

export function queueSize(): number {
  return pending.size;
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
      try {
        await refreshSegment(next);
      } catch {
        // refresh-segment handles its own errors; never throw past the queue.
      }
    }
  } finally {
    processing = false;
  }
}
