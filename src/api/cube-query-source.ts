/**
 * Cube query "source" — which app surface issued a /load.
 *
 * The proxy used to guess this from the Referer, but the Cube SDK fetch doesn't
 * send a useful one, so everything fell to "API". Instead the client attaches an
 * explicit `x-cube-source` header derived from the live SPA route at request
 * time (so it reflects the page actually running the query). The server stores
 * it on `query_perf`; the admin UI humanizes it.
 *
 * Machine values (stable, parseable): `query-builder`, `explore`,
 * `dashboard:<id>`, `segment:<id>[:<tab>]`, `catalog…`, `chat[:<id>]`, or the
 * raw first path segment. Tabs ride along when they're in the URL (`?tab=`).
 */

export const CUBE_SOURCE_HEADER = 'x-cube-source';

/** Derive the source machine string from `window.location`. Null when unknown. */
export function deriveCubeSource(): string | null {
  if (typeof window === 'undefined' || !window.location) return null;
  // The app uses HashRouter — the active route lives in `location.hash`
  // (e.g. `#/segments/45?tab=care`), NOT `location.pathname` (which is just
  // `/`). Parse the hash first; the `?tab=` query also rides inside the hash.
  // Fall back to pathname/search for any non-hash route.
  const hash = window.location.hash || '';
  let route = hash.startsWith('#') ? hash.slice(1) : '';
  let search = '';
  if (route) {
    const q = route.indexOf('?');
    if (q >= 0) {
      search = route.slice(q);
      route = route.slice(0, q);
    }
  } else {
    route = window.location.pathname;
    search = window.location.search;
  }
  const parts = route.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  const tab = new URLSearchParams(search).get('tab');
  const head = parts[0];
  switch (head) {
    case 'build':
      return 'query-builder';
    case 'explore':
      return 'explore';
    case 'dashboards':
      return parts[1] ? `dashboard:${parts.slice(1).join('/')}` : 'dashboards';
    case 'segments':
      if (!parts[1]) return 'segments';
      return tab ? `segment:${parts[1]}:${tab}` : `segment:${parts[1]}`;
    case 'catalog':
      return parts[1] ? `catalog:${parts.slice(1).join('/')}` : 'catalog';
    default:
      return tab ? `${parts.join('/')}:${tab}` : parts.join('/');
  }
}

const TITLE = (s: string): string => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Render a source machine string as a human label for the admin UI.
 *
 * `segmentName` (resolved server-side from the segment UUID) is preferred over
 * the raw id for `segment:<id>` sources — so the label reads "High-Value
 * Spenders · Members" instead of "Segment #b92b61ff…".
 */
export function humanizeCubeSource(src: string | null | undefined, segmentName?: string | null): string {
  if (!src) return 'API / server';
  // Older rows stored a raw Referer pathname (e.g. `/build`, `//`) before the
  // client tagged its requests. Strip leading/trailing slashes so they map to
  // the same labels and never render as a blank cell.
  const norm = src.replace(/^\/+|\/+$/g, '');
  if (!norm) return 'API / server';
  if (norm === 'query-builder' || norm === 'build') return 'Query Builder';
  if (norm === 'explore') return 'Explore';
  src = norm;
  if (src === 'chat' || src.startsWith('chat:')) {
    const id = src.split(':')[1];
    return id ? `Chat · ${id.slice(0, 8)}` : 'Chat';
  }
  if (src.startsWith('dashboard:')) return `Dashboard #${src.slice('dashboard:'.length)}`;
  if (src.startsWith('segment:')) {
    const [id, tab] = src.slice('segment:'.length).split(':');
    // Prefer the resolved name; fall back to a short id (UUIDs are long).
    const label = segmentName ? segmentName : `Segment #${id.slice(0, 8)}`;
    return tab ? `${label} · ${TITLE(tab)}` : label;
  }
  if (src.startsWith('catalog')) return 'Catalog';
  // Generic: title-case the leading token (e.g. "liveops/cohort" → "Liveops").
  return TITLE(src.split(/[:/?]/)[0]);
}
