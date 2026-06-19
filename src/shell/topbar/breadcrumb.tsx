/**
 * Breadcrumb — resolves cube routes to a chevron-separated trail in the topbar.
 *
 * Resolution strategy:
 *  - Longest matching static prefix from STATIC → label
 *  - Dynamic tail handled per-prefix (e.g. `/segments/{id}` → id verbatim)
 *  - Last crumb renders as plain text, all others as NavLink (RR5)
 */
import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { T, Icon } from '../theme';
import { TopbarBreadcrumbContext } from './topbar-breadcrumb-context';

interface Crumb {
  label: string;
  to?: string;
}

const STATIC: Array<{ prefix: string; label: string; to: string }> = [
  { prefix: '/build',                 label: 'Playground',       to: '/build' },
  { prefix: '/catalog/data-model',    label: 'Data Model',        to: '/catalog/data-model' },
  { prefix: '/data-model/new',        label: 'New Data Model',    to: '/data-model/new?v=2' },
  { prefix: '/catalog/metrics',       label: 'Metrics Catalog',   to: '/catalog/metrics' },
  { prefix: '/catalog/metric',        label: 'Metrics Catalog',   to: '/catalog/metrics' },
  { prefix: '/catalog/concept',       label: 'Data Model',        to: '/catalog/data-model' },
  { prefix: '/catalog/digest',        label: 'Digest',            to: '/catalog/digest' },
  { prefix: '/catalog/notifications', label: 'Notifications',     to: '/catalog/notifications' },
  { prefix: '/catalog/saved-views',   label: 'Saved Views',       to: '/catalog/saved-views' },
  { prefix: '/catalog/workspaces',    label: 'Workspaces',        to: '/catalog/workspaces' },
  { prefix: '/catalog/glossary',      label: 'Glossary',          to: '/catalog/glossary' },
  { prefix: '/segments/identity-map', label: 'Identity Map',      to: '/segments/identity-map' },
  { prefix: '/segments/snapshot-coverage', label: 'Snapshot Coverage', to: '/segments/snapshot-coverage' },
  { prefix: '/segments',              label: 'Segments',          to: '/segments' },
  { prefix: '/dashboards/cs',         label: 'CS · VIP Care',     to: '/dashboards/cs' },
  { prefix: '/dashboards',            label: 'Dashboards',        to: '/dashboards' },
  { prefix: '/ops',                   label: 'Ops Console',       to: '/ops' },
  { prefix: '/chat',                  label: 'Chat',              to: '/chat' },
  { prefix: '/catalog',               label: 'Catalog',           to: '/catalog/data-model' },
];

function resolveBreadcrumb(pathname: string): Crumb[] {
  let best: { prefix: string; label: string; to: string } | null = null;
  for (const entry of STATIC) {
    if (pathname === entry.prefix || pathname.startsWith(entry.prefix + '/')) {
      if (!best || entry.prefix.length > best.prefix.length) best = entry;
    }
  }
  if (!best) return [];

  const crumbs: Crumb[] = [{ label: best.label, to: best.to }];

  // Dynamic tail for known parent prefixes.
  const tail = pathname.slice(best.prefix.length).replace(/^\//, '');
  if (tail) {
    if (best.prefix === '/segments' && tail !== 'new') {
      crumbs.push({ label: decodeURIComponent(tail.split('/')[0]) });
    } else if (best.prefix === '/catalog/data-model') {
      crumbs.push({ label: decodeURIComponent(tail.split('/')[0]) });
    } else if (best.prefix === '/catalog/metric' && tail !== 'new') {
      crumbs.push({ label: decodeURIComponent(tail.split('/')[0]) });
    } else if (best.prefix === '/catalog/concept') {
      const parts = tail.split('/');
      if (parts.length >= 2) crumbs.push({ label: decodeURIComponent(parts[parts.length - 1]) });
    }
  }
  return crumbs;
}

export function Breadcrumb() {
  const location = useLocation();
  const { label: override } = React.useContext(TopbarBreadcrumbContext);
  const crumbs = resolveBreadcrumb(location.pathname);
  if (crumbs.length === 0) return <div style={{ flex: 1 }} />;

  // If a detail page registered a friendly label (e.g. segment.name), swap
  // the route-derived tail crumb for it.
  if (override && crumbs.length > 1) {
    crumbs[crumbs.length - 1] = { label: override };
  }

  return (
    <nav style={{
      display: 'flex', alignItems: 'center', gap: 6,
      fontSize: 13, fontFamily: T.fSans, flex: 1, minWidth: 0,
    }}>
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        const isLeaf = isLast && crumbs.length > 1;
        return (
          <React.Fragment key={`${c.label}-${i}`}>
            {i > 0 && <Icon icon={ChevronRight} size={12} color={'var(--shell-text-faint)'} />}
            {isLast || !c.to ? (
              <span style={{
                color: isLeaf ? 'var(--shell-brand)' : 'var(--shell-text-strong)', fontWeight: 600, maxWidth: 520,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }} aria-current={isLast ? 'page' : undefined}>
                {c.label}
              </span>
            ) : (
              <NavLink to={c.to} style={{
                color: 'var(--shell-text-muted)', fontWeight: 500, textDecoration: 'none', maxWidth: 240,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { (e.target as HTMLElement).style.color = 'var(--shell-text)'; }}
              onMouseLeave={e => { (e.target as HTMLElement).style.color = 'var(--shell-text-muted)'; }}>
                {c.label}
              </NavLink>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
