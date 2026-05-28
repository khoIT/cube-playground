/**
 * workspace-cache-bus — tiny pub/sub for clearing module-level caches when the
 * active Cube workspace changes.
 *
 * Why: many hooks (`use-business-metrics`, `use-metric-drift`, the new-metric
 * wizard column-stats / row-count / time-range caches, …) keep module-level
 * Maps keyed by `gameId` only. When the user switches workspace, those Maps
 * would happily serve data fetched against the old backend whose cube namespace
 * (prefixed `<prefix>_<base>` on prod vs flat on local) doesn't even exist on
 * the new one. The fix: clear them on workspace-change.
 *
 * Each consumer module calls `onWorkspaceChange(() => myCache.clear())` once
 * at import time. The listener stays alive for the lifetime of the bundle —
 * intentional, since the caches it clears live for the same lifetime.
 */

import { WORKSPACE_CHANGE_EVENT } from '../components/workspace-context';

export type WorkspaceCacheClearer = () => void;

/**
 * Register a cache-clear callback that fires on every workspace switch.
 * Safe to call at module top-level; no-ops on the server (no `window`).
 */
export function onWorkspaceChange(clear: WorkspaceCacheClearer): void {
  if (typeof window === 'undefined') return;
  window.addEventListener(WORKSPACE_CHANGE_EVENT, () => {
    try {
      clear();
    } catch {
      // A throwing clear() in one cache must not stop others from clearing.
    }
  });
}
