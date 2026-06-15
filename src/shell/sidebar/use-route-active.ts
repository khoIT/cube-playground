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
    return location.pathname === p || location.pathname.startsWith(p + '/');
  });
}
