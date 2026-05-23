/**
 * Per-module collapsed state for catalog filter bars. localStorage-backed so
 * the user's preference (show all filter pills vs. just the header) survives
 * reloads, with a custom event so multiple components stay in sync.
 */

const KEY_PREFIX = 'gds-cube.filter-bar-collapsed.v1.';
const EVENT = 'gds-cube:filter-bar-collapsed-changed';

export type FilterBarModule = 'metrics-catalog' | 'data-model';

function key(module: FilterBarModule): string {
  return KEY_PREFIX + module;
}

export function getFilterBarCollapsed(module: FilterBarModule): boolean {
  try {
    return localStorage.getItem(key(module)) === '1';
  } catch {
    return false;
  }
}

export function setFilterBarCollapsed(module: FilterBarModule, collapsed: boolean): void {
  try {
    localStorage.setItem(key(module), collapsed ? '1' : '0');
  } catch {
    // ignore
  }
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
