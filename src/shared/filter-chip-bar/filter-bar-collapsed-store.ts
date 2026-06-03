/**
 * Per-module collapsed state for catalog filter bars. Persisted via the
 * DB-authoritative pref store (localStorage mirror keeps reads synchronous).
 * Custom event keeps multiple same-page components in sync.
 */

import { getPref, setPref } from '../../hooks/server-prefs-store';

const KEY_PREFIX = 'gds-cube.filter-bar-collapsed.v1.';
const EVENT = 'gds-cube:filter-bar-collapsed-changed';

export type FilterBarModule = 'metrics-catalog' | 'data-model' | 'glossary';

function key(module: FilterBarModule): string {
  return KEY_PREFIX + module;
}

export function getFilterBarCollapsed(module: FilterBarModule): boolean {
  return getPref(key(module)) === '1';
}

export function setFilterBarCollapsed(module: FilterBarModule, collapsed: boolean): void {
  setPref(key(module), collapsed ? '1' : '0');
  try {
    window.dispatchEvent(
      new CustomEvent(EVENT, { detail: { module, collapsed } }),
    );
  } catch {
    // ignore
  }
}

export function onFilterBarCollapsedChange(
  module: FilterBarModule,
  handler: (collapsed: boolean) => void,
): () => void {
  const listener = (ev: Event) => {
    const detail = (ev as CustomEvent<{ module: FilterBarModule; collapsed: boolean }>)
      .detail;
    if (detail && detail.module === module) handler(detail.collapsed);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
