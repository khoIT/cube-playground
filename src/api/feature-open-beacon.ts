/**
 * Feature-open telemetry beacon.
 *
 * The SPA fires one fire-and-forget POST per visited feature surface so the
 * activity spine records `feature_open` events. Failures are swallowed — a
 * dropped beacon must never affect navigation. The server validates the key
 * against the closed FEATURE_KEYS registry, so an unmapped path is simply not
 * reported (no error surfaced to the user).
 */

import { apiFetch } from './api-client';

/** Server-side FeatureKey vocabulary (mirror of server `feature-keys.ts`). */
export type FeatureKey =
  | 'chats'
  | 'playground'
  | 'data-model'
  | 'metrics-catalog'
  | 'liveops'
  | 'dashboards'
  | 'segments'
  | 'admin';

/**
 * Map a router pathname to its FeatureKey. Ordered longest-prefix-first so
 * `/data-model` wins over `/data`. Returns null for paths that don't map to a
 * tracked feature (e.g. /settings) — those are not reported.
 */
export function featureForPath(pathname: string): FeatureKey | null {
  const p = pathname.toLowerCase();
  const prefixMatch: Array<[string, FeatureKey]> = [
    ['/chat', 'chats'],
    ['/build', 'playground'],
    ['/data-model', 'data-model'],
    ['/data', 'data-model'],
    ['/catalog', 'metrics-catalog'],
    ['/metric', 'metrics-catalog'],
    ['/schema', 'metrics-catalog'],
    ['/liveops', 'liveops'],
    ['/dashboards', 'dashboards'],
    ['/segments', 'segments'],
    ['/admin', 'admin'],
  ];
  for (const [prefix, key] of prefixMatch) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return key;
  }
  return null;
}

/** Fire-and-forget beacon; never throws. */
export function recordFeatureOpen(feature: FeatureKey): void {
  emitActivity({ eventType: 'feature_open', targetId: feature });
}

/** Report a chart/query/CSV export. `kind` describes what was exported. */
export function recordExport(kind: string, id?: string): void {
  emitActivity({ eventType: 'export', targetType: kind, targetId: id });
}

/** Report a workspace switch (the workspace id switched to). */
export function recordWorkspaceSwitch(workspaceId: string): void {
  emitActivity({ eventType: 'workspace_switch', targetId: workspaceId });
}

/**
 * Report a Cube backend reachability transition. Fired by the health probe on
 * the edges only (not every poll): `unreachable` when the backend first drops,
 * `recovered` when it comes back — the latter carries how long it was down so
 * outages are countable and measurable after the fact.
 */
export function recordCubeOutage(phase: 'unreachable' | 'recovered', durationMs?: number): void {
  emitActivity({ eventType: 'cube_outage', targetId: phase, durationMs });
}

interface ActivityBeacon {
  eventType: 'feature_open' | 'export' | 'workspace_switch' | 'cube_outage';
  targetType?: string;
  targetId?: string;
  durationMs?: number;
}

/** Single fire-and-forget POST; telemetry is best-effort and never throws. */
function emitActivity(beacon: ActivityBeacon): void {
  void apiFetch('/api/activity', { method: 'POST', body: beacon }).catch(() => {
    /* swallow — a dropped beacon must never affect the UI */
  });
}
