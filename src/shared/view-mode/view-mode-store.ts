/**
 * View-mode preference for catalog pages. Persisted via the DB-authoritative
 * pref store (localStorage mirror keeps reads synchronous). Broadcasts a
 * custom event so multiple components on the same page stay in sync.
 */

import { getPref, setPref } from '../../hooks/server-prefs-store';

const KEY_PREFIX = 'gds-cube.view-mode.v1.';
const EVENT = 'gds-cube:view-mode-changed';

export type ViewMode = 'grid' | 'list';
export type ViewModule = 'metrics-catalog' | 'data-model';

const DEFAULT: ViewMode = 'grid';

function key(module: ViewModule): string {
  return KEY_PREFIX + module;
}

export function getViewMode(module: ViewModule): ViewMode {
  const raw = getPref(key(module));
  if (raw === 'grid' || raw === 'list') return raw;
  return DEFAULT;
}

export function setViewMode(module: ViewModule, mode: ViewMode): void {
  setPref(key(module), mode);
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { module, mode } }));
  } catch {
    // ignore
  }
}

export function onViewModeChange(
  module: ViewModule,
  handler: (mode: ViewMode) => void,
): () => void {
  const listener = (ev: Event) => {
    const detail = (ev as CustomEvent<{ module: ViewModule; mode: ViewMode }>).detail;
    if (detail && detail.module === module) handler(detail.mode);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
