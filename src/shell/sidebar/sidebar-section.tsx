/**
 * SidebarSection — wraps SidebarItem header + optional expanded content.
 * Persists expand state to localStorage via sidebar-section-store helpers.
 * When sidebar is collapsed (60px rail), children + caret are hidden.
 * When expanded, children sit inside a tree-line guide container.
 */
import React from 'react';
import { SidebarItem } from './sidebar-item';
import { getSectionExpanded, setSectionExpanded } from './sidebar-section-store';
import type { LucideIcon } from '../theme';

interface SidebarSectionProps {
  /** Stable id for persisted expand state. */
  id: string;
  icon: LucideIcon;
  label: string;
  /** Click destination for the header. Omit for pure expand-only groups. */
  to?: string;
  /** Active-route prefix; defaults to `to`. */
  matchPrefix?: string;
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

  return (
    <div>
      <SidebarItem
        icon={icon}
        label={headerLabel}
        to={to}
        matchPrefix={matchPrefix}
        expandable={!flat && !collapsed}
        expanded={expanded}
        onClick={onToggle}
        collapsed={collapsed}
      />
      {showChildren && (
        <div style={{ position: 'relative' }}>
          {/* Tree-guide sits inside the parent icon column so child rows
              align vertically with the parent label rather than sitting
              far to its right. */}
          <div style={{
            position: 'absolute', left: 19, top: 4, bottom: 4, width: 1,
            background: 'rgba(0,0,0,0.08)', pointerEvents: 'none',
          }} />
          {children}
        </div>
      )}
    </div>
  );
}
