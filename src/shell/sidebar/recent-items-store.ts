/**
 * Recent items LRU store, persisted in localStorage.
 * Used by sidebar Data Model / Metrics Catalog / Segments / Chat sections.
 *
 * Key shape: gds-cube.recent.v1.{module}
 * Max items: 8 (oldest evicted on push).
 */

const VERSION = 'v1';
const MAX = 8;
const EVENT = 'gds-cube:recent-changed';

export type RecentModule = 'chat' | 'data-model' | 'metrics-catalog' | 'segments';

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

const key = (m: RecentModule) => `gds-cube.recent.${VERSION}.${m}`;

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

export function clearRecent(module: RecentModule): void {
  try { localStorage.removeItem(key(module)); } catch { /* noop */ }
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* noop */ }
}
