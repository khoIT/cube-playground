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
import { T, Icon, type LucideIcon } from '../theme';

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

  const tree = showChildren && (
    <div style={{ position: 'relative' }}>
      {/* Tree-guide sits inside the parent icon column so child rows align
          vertically with the parent label rather than sitting far to its right. */}
      <div style={{
        position: 'absolute', left: 19, top: 4, bottom: 4, width: 1,
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
          background: rowHovered ? 'rgba(0,0,0,0.04)' : 'transparent',
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
            border: 'none', borderRadius: 4, cursor: 'pointer', padding: 0,
            // Picks up the row's light bg on row hover; darkens on direct hover.
            background: arrowHovered
              ? 'rgba(0,0,0,0.08)'
              : rowHovered ? 'rgba(0,0,0,0.04)' : 'transparent',
            transition: 'background .12s',
          }}
        >
          <Icon
            icon={ChevronDown}
            size={14}
            color={T.n400}
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
