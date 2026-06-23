/**
 * useRouteActive — shared active-route match for sidebar rows and section
 * headers. A header (SidebarSection) and its link half (SidebarItem) must agree
 * on "is this the current route" so the inset pill paints once across the whole
 * header row, so the match lives here rather than duplicated in each.
 */
import { useLocation } from 'react-router-dom';

export function useRouteActive(
  to?: string,
  matchPrefix?: string | string[],
  // Exact: match only the precise pathname, never sub-routes. Needed for a row
  // that points at a section landing (e.g. /liveops) sitting beside sibling rows
  // for its sub-routes (/liveops/*) — prefix matching would keep the landing row
  // lit on every sub-page.
  exact?: boolean,
): boolean {
  const location = useLocation();
  const prefixes: string[] = matchPrefix
    ? Array.isArray(matchPrefix) ? matchPrefix : [matchPrefix]
    : to ? [to] : [];
  const fullUrl = location.pathname + location.search;
  return prefixes.some(p => {
    // Hrefs that embed a query string (e.g. /build?query=...) need to match the
    // search portion too — otherwise every playground recent would look active
    // simultaneously because they all share the /build pathname.
    if (p.includes('?')) return fullUrl === p;
    if (p === '/') return location.pathname === '/';
    if (exact) return location.pathname === p;
    return location.pathname === p || location.pathname.startsWith(p + '/');
  });
}
