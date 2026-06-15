/**
 * SidebarSection — wraps SidebarItem header + optional expanded content.
 * Persists expand state to localStorage via sidebar-section-store helpers.
 * When sidebar is collapsed (60px rail), children + caret are hidden.
 * When expanded, children sit inside a tree-line guide container.
 */
import React from 'react';
import { ChevronDown } from 'lucide-react';
import { SidebarItem } from './sidebar-item';
import { getSectionExpanded, setSectionExpanded } from './sidebar-section-store';
import { useRouteActive } from './use-route-active';
import { Icon, type LucideIcon } from '../theme';

interface SidebarSectionProps {
  /** Stable id for persisted expand state. */
  id: string;
  icon: LucideIcon;
  label: string;
  /** Click destination for the header. Omit for pure expand-only groups. */
  to?: string;
  /** Active-route prefix(es); defaults to `to`. Use an array when the section
   *  covers multiple route roots (e.g. plural list + singular detail). */
  matchPrefix?: string | string[];
  /** If provided, renders content under header when expanded. */
  children?: React.ReactNode;
  /** Render flat (no caret) — used for simple links. */
  flat?: boolean;
  /** Sidebar is in 60px icon-rail mode. */
  collapsed?: boolean;
  /** Hide label text when expanded — gives an unbranded look once sub-items reveal. */
  hideLabelWhenExpanded?: boolean;
}

export function SidebarSection({
  id, icon, label, to, matchPrefix, children, flat, collapsed,
  hideLabelWhenExpanded,
}: SidebarSectionProps) {
  const [expanded, setExpanded] = React.useState(() =>
    flat ? false : getSectionExpanded(id)
  );

  React.useEffect(() => {
    if (flat) return;
    const handler = () => setExpanded(getSectionExpanded(id));
    window.addEventListener('gds-cube:sidebar-expand-changed', handler);
    return () => window.removeEventListener('gds-cube:sidebar-expand-changed', handler);
  }, [id, flat]);

  const onToggle = React.useCallback(() => {
    if (flat) return;
    setExpanded(prev => {
      const next = !prev;
      setSectionExpanded(id, next);
      return next;
    });
  }, [id, flat]);

  const showChildren = !flat && expanded && !!children && !collapsed;
  const headerLabel = hideLabelWhenExpanded && expanded && !collapsed ? '' : label;

  // A split header (label navigates / separate arrow toggles) only applies to
  // expandable sections in the wide rail. Flat links and the collapsed icon
  // rail render a single navigable row with no toggle arrow.
  const isSplit = !flat && !collapsed;

  const [rowHovered, setRowHovered] = React.useState(false);
  const [arrowHovered, setArrowHovered] = React.useState(false);

  // The whole header row (link half + caret half) shares one inset pill, so the
  // active match is computed here rather than left to the inner SidebarItem.
  const headerActive = useRouteActive(to, matchPrefix);

  const tree = showChildren && (
    <div style={{ position: 'relative' }}>
      {/* Short tree spine — sits just right of the parent icon column (x=18) and
          is inset top/bottom so it spans only the real child rows rather than
          running the full column past the trailing "See all…" link. */}
      <div style={{
        position: 'absolute', left: 18, top: 5, bottom: 5, width: 1,
        background: 'rgba(0,0,0,0.08)', pointerEvents: 'none',
      }} />
      {children}
    </div>
  );

  if (!isSplit) {
    return (
      <div>
        <SidebarItem
          icon={icon}
          label={headerLabel}
          to={to}
          matchPrefix={matchPrefix}
          collapsed={collapsed}
        />
        {tree}
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          // Inset rounded pill shared by both halves of the header row. An
          // active section wears the soft brand pill; hover is a neutral darken.
          margin: '1px 0',
          borderRadius: 8,
          background: headerActive
            ? 'var(--shell-nav-active)'
            : rowHovered ? 'var(--shell-nav-hover)' : 'transparent',
          transition: 'background .12s',
        }}
        onMouseEnter={() => setRowHovered(true)}
        onMouseLeave={() => setRowHovered(false)}
      >
        {/* Link half — navigates to the section page, never toggles. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <SidebarItem
            icon={icon}
            label={headerLabel}
            to={to}
            matchPrefix={matchPrefix}
            headerLink
          />
        </div>

        {/* Toggle half — opens/closes the child list, never navigates. */}
        <button
          type="button"
          aria-label={`Toggle ${label} list`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
          onMouseEnter={() => setArrowHovered(true)}
          onMouseLeave={() => setArrowHovered(false)}
          style={{
            width: 28, height: 28, marginRight: 4, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', borderRadius: 6, cursor: 'pointer', padding: 0,
            // Transparent at rest so the shared header pill shows through;
            // darkens only on direct hover of the caret itself.
            background: arrowHovered ? 'rgba(0,0,0,0.08)' : 'transparent',
            transition: 'background .12s',
          }}
        >
          <Icon
            icon={ChevronDown}
            size={14}
            color={'var(--shell-text-faint)'}
            style={{
              transition: 'transform .2s',
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            }}
          />
        </button>
      </div>
      {tree}
    </div>
  );
}
