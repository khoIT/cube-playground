/**
 * RecentItems — renders a module's recent entries from localStorage as
 * indented sidebar sub-rows, capped at `visible` + a "See all..." link.
 */
import React from 'react';
import { SidebarItem } from './sidebar-item';
import { SidebarSubheader } from './sidebar-subheader';
import { getRecent, type RecentModule } from './recent-items-store';
import type { LucideIcon } from '../theme';

interface RecentItemsProps {
  module: RecentModule;
  /** Module landing route (where "See all..." goes). */
  seeAllTo: string;
  /** How to construct an item href; defaults to `${seeAllTo}/${id}`. */
  hrefFor?: (id: string) => string;
  /** Visible item cap (default 4). */
  visible?: number;
  /** Optional uppercase subheader rendered above the list when items exist. */
  subheader?: string;
  /** Optional filter predicate — hide dangling/orphan recents. */
  filter?: (item: { id: string; title: string }) => boolean;
  /** Optional per-item leading glyph (e.g. Live/Static segment marker). */
  iconFor?: (item: { id: string; title: string }) => { icon: LucideIcon; iconColor?: string; title?: string } | undefined;
  /** Empty-state label override (default "No recent items"). */
  emptyLabel?: string;
}

export function RecentItems({
  module, seeAllTo, hrefFor, visible = 4, subheader, filter, iconFor, emptyLabel = 'No recent items',
}: RecentItemsProps) {
  const [rawItems, setItems] = React.useState(() => getRecent(module));

  React.useEffect(() => {
    const handler = () => setItems(getRecent(module));
    window.addEventListener('gds-cube:recent-changed', handler);
    // Game / workspace switch swap the underlying bucket key — re-read so the
    // tray shows the new bucket's recents instead of the prior workspace's.
    window.addEventListener('gds-cube:game-change', handler);
    window.addEventListener('gds-cube:workspace-change', handler);
    return () => {
      window.removeEventListener('gds-cube:recent-changed', handler);
      window.removeEventListener('gds-cube:game-change', handler);
      window.removeEventListener('gds-cube:workspace-change', handler);
    };
  }, [module]);

  const items = filter ? rawItems.filter(i => filter({ id: i.id, title: i.title })) : rawItems;

  if (items.length === 0) {
    return <SidebarItem label={emptyLabel} to={seeAllTo} indent muted neverActive />;
  }

  const shown = items.slice(0, visible);
  return (
    <>
      {subheader && <SidebarSubheader>{subheader}</SidebarSubheader>}
      {shown.map(item => {
        const kind = iconFor?.({ id: item.id, title: item.title });
        return (
          <SidebarItem
            key={item.id}
            label={item.title}
            to={item.href ?? hrefFor?.(item.id) ?? `${seeAllTo}/${item.id}`}
            indent
            icon={kind?.icon}
            iconColor={kind?.iconColor}
          />
        );
      })}
      {items.length > visible && (
        <SidebarItem label={`See all... (${items.length})`} to={seeAllTo} indent muted neverActive />
      )}
    </>
  );
}

export function notifyRecentChanged() {
  window.dispatchEvent(new Event('gds-cube:recent-changed'));
}
