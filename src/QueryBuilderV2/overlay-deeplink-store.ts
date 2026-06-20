/**
 * Durable store for a combined dual-axis artifact's OVERLAY query, keyed by the
 * chat artifact id. Unlike the primary deeplink payload (one-shot sessionStorage
 * that degrades to the builder's persisted query tab), the overlay has no tab
 * state to fall back on — so a page refresh would silently drop the right-axis
 * series and the center chart would revert to the primary single-series view.
 *
 * Persisting the overlay in localStorage keyed by artifact id lets a refresh of
 * /build re-derive the same dual-axis. A small FIFO index caps how many overlays
 * we retain so the store can't grow unbounded across many opened artifacts.
 */

const PREFIX = 'gds-cube:chat-deeplink-overlay:';
const INDEX_KEY = 'gds-cube:chat-deeplink-overlay-index';
const MAX_RETAINED = 20;

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

/** Persist an overlay query for `id`, evicting the oldest beyond the cap. */
export function saveOverlayPayload(id: string, payload: unknown): void {
  try {
    localStorage.setItem(PREFIX + id, JSON.stringify(payload));
    // Move id to the most-recent end; evict overflow from the front.
    const index = readIndex().filter((x) => x !== id);
    index.push(id);
    while (index.length > MAX_RETAINED) {
      const evicted = index.shift();
      if (evicted) localStorage.removeItem(PREFIX + evicted);
    }
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // quota/unavailable — non-fatal; the center simply degrades to primary-only.
  }
}

/** Read the overlay query for `id`, or null if absent/unparseable. */
export function loadOverlayPayload(id: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
