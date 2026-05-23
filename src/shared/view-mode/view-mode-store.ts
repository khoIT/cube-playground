/**
 * View-mode preference for catalog pages. Persisted in localStorage so the
 * user's grid-vs-list choice survives reloads, and broadcasts a custom event
 * so multiple components on the page stay in sync.
 */

const KEY_PREFIX = 'gds-cube.view-mode.v1.';
const EVENT = 'gds-cube:view-mode-changed';

export type ViewMode = 'grid' | 'list';
export type ViewModule = 'metrics-catalog' | 'data-model';

const DEFAULT: ViewMode = 'grid';

function key(module: ViewModule): string {
  return KEY_PREFIX + module;
}

export function getViewMode(module: ViewModule): ViewMode {
  try {
    const raw = localStorage.getItem(key(module));
    if (raw === 'grid' || raw === 'list') return raw;
  } catch {
    // ignore
  }
  return DEFAULT;
}

export function setViewMode(module: ViewModule, mode: ViewMode): void {
  try {
    localStorage.setItem(key(module), mode);
  } catch {
    // ignore
  }
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
