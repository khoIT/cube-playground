/**
 * Durable store for a combined dual-axis artifact's OVERLAY query, keyed by the
 * PRIMARY query's identity (its measures + time dimensions) — NOT by the chat
 * artifact id or any URL param.
 *
 * Why keyed by the primary query: the builder canonicalizes its URL to
 * `?query=<primary>` the moment the query runs (for shareability), erasing the
 * `from-chat-artifact` / `combined=1` params the overlay used to ride on. Keying
 * the overlay by the primary query means the center can re-attach it from
 * whatever query the active tab currently holds — surviving that URL rewrite,
 * a page refresh, and tab switches, with no dependence on transient params.
 *
 * A small FIFO index caps retention so the store can't grow unbounded across
 * many opened artifacts.
 */

import type { Query } from '@cubejs-client/core';

const PREFIX = 'gds-cube:chat-overlay-by-primary:';
const INDEX_KEY = 'gds-cube:chat-overlay-by-primary-index';
const MAX_RETAINED = 20;

/**
 * Stable identity for a primary query: its measures (sorted) + each time
 * dimension's dimension/granularity/dateRange. Deliberately ignores `filters`
 * and other fields so the key matches whether or not the container has appended
 * a game filter to the query (the game filter never changes measures/grain).
 */
export function primaryQueryKey(query: unknown): string {
  const q = (query ?? {}) as {
    measures?: string[];
    timeDimensions?: Array<{ dimension?: string; granularity?: string; dateRange?: unknown }>;
  };
  const measures = [...(q.measures ?? [])].sort();
  const timeDimensions = (q.timeDimensions ?? []).map((td) => ({
    d: td.dimension ?? null,
    g: td.granularity ?? null,
    r: td.dateRange ?? null,
  }));
  return JSON.stringify({ measures, timeDimensions });
}

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

/** Persist `overlay` for the given primary key, evicting the oldest beyond the cap. */
export function saveOverlayForPrimary(primaryKey: string, overlay: unknown): void {
  try {
    localStorage.setItem(PREFIX + primaryKey, JSON.stringify(overlay));
    // Move this key to the most-recent end; evict overflow from the front.
    const index = readIndex().filter((k) => k !== primaryKey);
    index.push(primaryKey);
    while (index.length > MAX_RETAINED) {
      const evicted = index.shift();
      if (evicted) localStorage.removeItem(PREFIX + evicted);
    }
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // quota/unavailable — non-fatal; the center simply degrades to primary-only.
  }
}

/**
 * Remove the overlay stored for `primaryKey` (the user dismissed it from the
 * Results chip) and drop it from the FIFO index. Idempotent — a no-op when the
 * key isn't present. Persisting the removal means a refresh keeps it gone;
 * re-opening the combined artifact writes it back under the same key.
 */
export function removeOverlayForPrimary(primaryKey: string): void {
  try {
    localStorage.removeItem(PREFIX + primaryKey);
    const index = readIndex().filter((k) => k !== primaryKey);
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // quota/unavailable — non-fatal.
  }
}

/** Read the overlay query stored for `primaryKey`, or null if absent/unparseable. */
export function loadOverlayForPrimary(primaryKey: string): Query | null {
  try {
    const raw = localStorage.getItem(PREFIX + primaryKey);
    return raw ? (JSON.parse(raw) as Query) : null;
  } catch {
    return null;
  }
}
