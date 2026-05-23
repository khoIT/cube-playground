/**
 * RecentItems — renders a module's recent entries from localStorage as
 * indented sidebar sub-rows, capped at `visible` + a "See all..." link.
 */
import React from 'react';
import { SidebarItem } from './sidebar-item';
import { SidebarSubheader } from './sidebar-subheader';
import { getRecent, type RecentModule } from './recent-items-store';

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
  /** Empty-state label override (default "No recent items"). */
  emptyLabel?: string;
}

export function RecentItems({
  module, seeAllTo, hrefFor, visible = 4, subheader, filter, emptyLabel = 'No recent items',
}: RecentItemsProps) {
  const [rawItems, setItems] = React.useState(() => getRecent(module));

  React.useEffect(() => {
    const handler = () => setItems(getRecent(module));
    window.addEventListener('gds-cube:recent-changed', handler);
    return () => window.removeEventListener('gds-cube:recent-changed', handler);
  }, [module]);

  const items = filter ? rawItems.filter(i => filter({ id: i.id, title: i.title })) : rawItems;

  if (items.length === 0) {
    return <SidebarItem label={emptyLabel} to={seeAllTo} indent muted />;
  }

  const shown = items.slice(0, visible);
  return (
    <>
      {subheader && <SidebarSubheader>{subheader}</SidebarSubheader>}
      {shown.map(item => (
        <SidebarItem
          key={item.id}
          label={item.title}
          to={item.href ?? hrefFor?.(item.id) ?? `${seeAllTo}/${item.id}`}
          indent
        />
      ))}
      {items.length > visible && (
        <SidebarItem label={`See all... (${items.length})`} to={seeAllTo} indent muted />
      )}
    </>
  );
}

export function notifyRecentChanged() {
  window.dispatchEvent(new Event('gds-cube:recent-changed'));
}
