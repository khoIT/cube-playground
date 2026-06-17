/**
 * useRelativeTimeTick — a shared ticker that refreshes relative timestamps
 * ("5 minutes ago") in place, without a page reload.
 *
 * Relative labels are computed at render time, so a memoized message that never
 * re-renders keeps showing its first value ("2 hours ago") forever. Subscribing
 * to this tick forces the subscribing component to re-render on a fixed cadence
 * so the label recomputes against the current clock.
 *
 * One module-level interval drives every subscriber — N visible timestamps cost
 * one timer, not N — and it is torn down whenever the last subscriber unmounts.
 */
import { useEffect, useState } from 'react';

/** Refresh cadence — 30s keeps the minute-grain label honest without churn. */
const TICK_MS = 30_000;

const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(() => {
    for (const cb of subscribers) cb();
  }, TICK_MS);
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  ensureTimer();
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * Returns a counter that increments every {@link TICK_MS}. The value itself is
 * irrelevant — reading it subscribes the caller to the shared tick so it
 * re-renders periodically and any relative timestamp it derives stays fresh.
 */
export function useRelativeTimeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);
  return tick;
}
