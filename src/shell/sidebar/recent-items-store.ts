/**
 * Recent items LRU store, persisted in localStorage.
 * Used by sidebar Data Model / Metrics Catalog / Segments sections.
 *
 * Key shape: gds-cube.recent.v2.{module}.{gameId}
 * Max items per (module, gameId): 8 (oldest evicted on push).
 *
 * v2 added per-game scoping so switching game in the picker yields the right
 * recents tray; v1 mixed all games into one bucket and showed stale items.
 */

const VERSION = 'v2';
const MAX = 8;
const EVENT = 'gds-cube:recent-changed';
const GAME_STORAGE_KEY = 'gds-cube:active-game';
const NO_GAME = '__default__';

export type RecentModule = 'data-model' | 'metrics-catalog' | 'segments' | 'playground';

export interface RecentItem {
  /** Stable id (route param). */
  id: string;
  /** Visible label. */
  title: string;
  /** ISO timestamp of last activity — used for sort tie-break. */
  updatedAt: string;
  /** Optional href override; defaults to module-derived route. */
  href?: string;
}

function activeGameId(): string {
  try {
    return localStorage.getItem(GAME_STORAGE_KEY) || NO_GAME;
  } catch {
    return NO_GAME;
  }
}

const key = (m: RecentModule, gameId: string = activeGameId()) =>
  `gds-cube.recent.${VERSION}.${m}.${gameId}`;

export function getRecent(module: RecentModule): RecentItem[] {
  try {
    const raw = localStorage.getItem(key(module));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Business-metric ids are slugs without dots. Historical residue from a
    // redirect bug stamped cube-measure refs (e.g. `cube.cube.member`) into
    // Metrics Catalog recents — strip those on read so the tray self-heals
    // without users needing to clear localStorage.
    if (module === 'metrics-catalog') {
      return (parsed as RecentItem[]).filter(
        (it) => it && typeof it.id === 'string' && !it.id.includes('.'),
      );
    }
    // Playground recents key by tab id (small integers). An earlier revision
    // keyed by query fingerprint, leaving non-numeric residue that would never
    // dedupe against the new scheme — filter those out so the tray self-heals.
    if (module === 'playground') {
      return (parsed as RecentItem[]).filter(
        (it) => it && typeof it.id === 'string' && /^\d+$/.test(it.id),
      );
    }
    return parsed as RecentItem[];
  } catch {
    return [];
  }
}

export function pushRecent(module: RecentModule, item: RecentItem): void {
  try {
    const cur = getRecent(module).filter(i => i.id !== item.id);
    const next = [item, ...cur].slice(0, MAX);
    localStorage.setItem(key(module), JSON.stringify(next));
  } catch { /* noop */ }
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* noop */ }
}

/** Evict a single recent entry by id. Used by delete flows so the sidebar
 *  tray drops the row instantly without waiting for the page to remount. */
export function removeRecent(module: RecentModule, id: string): void {
  try {
    const cur = getRecent(module).filter((i) => i.id !== id);
    localStorage.setItem(key(module), JSON.stringify(cur));
  } catch { /* noop */ }
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* noop */ }
}

export function clearRecent(module: RecentModule): void {
  try { localStorage.removeItem(key(module)); } catch { /* noop */ }
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* noop */ }
}
