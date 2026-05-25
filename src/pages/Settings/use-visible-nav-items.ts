/**
 * Sidebar nav-item visibility preference.
 *
 * Mirrors `use-visible-games.ts`: stores a *blocklist* of hidden sidebar
 * section ids in localStorage. Missing entries default to visible so the
 * sidebar self-heals as new sections ship. Hidden sections still resolve via
 * their direct routes — this only trims the left rail. In-tab sync uses a
 * custom event so the sidebar + settings page update together.
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'gds-cube:hidden-nav-ids';
const STORAGE_EVENT = 'gds-cube:hidden-nav-change';

export type NavItemId =
  | 'chats'
  | 'playground'
  | 'data-model'
  | 'metrics-catalog'
  | 'liveops'
  | 'dashboards'
  | 'segments';

export interface NavItemDescriptor {
  id: NavItemId;
  labelKey: string;
}

export const NAV_ITEMS: NavItemDescriptor[] = [
  { id: 'chats', labelKey: 'nav.chat' },
  { id: 'playground', labelKey: 'nav.playground' },
  { id: 'data-model', labelKey: 'nav.dataModel' },
  { id: 'metrics-catalog', labelKey: 'nav.metricsCatalog' },
  { id: 'liveops', labelKey: 'nav.liveops' },
  { id: 'dashboards', labelKey: 'nav.dashboards' },
  { id: 'segments', labelKey: 'nav.segments' },
];

function readHidden(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeHidden(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT));
  } catch {
    // ignore quota / private mode
  }
}

export interface VisibleNavItemsApi {
  hidden: Set<string>;
  isVisible: (id: NavItemId) => boolean;
  toggle: (id: NavItemId) => void;
  showAll: () => void;
}

export function useVisibleNavItems(): VisibleNavItemsApi {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(readHidden()));

  useEffect(() => {
    const sync = () => setHidden(new Set(readHidden()));
    window.addEventListener(STORAGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(STORAGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const toggle = useCallback((id: NavItemId) => {
    const next = new Set(readHidden());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Guard against blanking the rail entirely — at least one section must
    // stay visible so the user can navigate back to settings.
    if (next.size >= NAV_ITEMS.length) return;
    writeHidden([...next]);
  }, []);

  const showAll = useCallback(() => writeHidden([]), []);

  const isVisible = useCallback((id: NavItemId) => !hidden.has(id), [hidden]);

  return { hidden, isVisible, toggle, showAll };
}
