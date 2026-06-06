/**
 * Server-local copy of the member-360 panel query builder
 * (`src/pages/Segments/member360/build-panel-query.ts`) — same structural
 * blocker as the registry copy (FE module imports `Query` from
 * `@cubejs-client/core`, outside the server's tsconfig rootDir). Logic is
 * byte-identical so cached rows match what the FE would have fetched live;
 * the parity test compares built queries against the FE builder's output.
 *
 * The identity filter keys `panel.identityKey` per view (NOT a blanket
 * identity dim): profile/timelines join `user_id`; login/logout sessions key
 * `clientsdkuserid`; FPS event panels key `playerid` via the role bridge.
 * Core panels — the only precomputed set — are all `user_id` today.
 */

import type { Member360Panel } from './member360-panel-registry.js';

export type DateRange = [string, string];

/** Minimal local stand-in for `Query` from @cubejs-client/core. */
export interface PanelQuery {
  dimensions?: string[];
  measures?: string[];
  filters: Array<{ member: string; operator: string; values: string[] }>;
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
}

/** Default behavior window: last 30 days inclusive, ending today. */
export function defaultBehaviorRange(today: Date): DateRange {
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  return [from, to];
}

/**
 * @param panel    the panel config
 * @param idValues identity filter values — `[uid]` for user_id/clientsdkuserid,
 *                 the user's `role_id`s for playerid-keyed event panels
 * @param dateRange required for behavior panels; ignored otherwise
 * @returns a Cube query, or null when there's nothing to query (no identity)
 */
export function buildPanelQuery(
  panel: Member360Panel,
  idValues: string[],
  dateRange?: DateRange,
): PanelQuery | null {
  if (idValues.length === 0) return null;

  const colDims = panel.columns.filter((c) => c.kind === 'dimension').map((c) => c.member);
  const measures = panel.columns.filter((c) => c.kind === 'measure').map((c) => c.member);
  // KPI cards (profile panel) read their own members — fetch them too. All KPI
  // members are flat per-user dimensions on mf_users, so they join `dimensions`.
  const kpiDims = panel.kpis?.map((k) => k.member) ?? [];
  const dims = [...new Set([...colDims, ...kpiDims])];

  // Lead with the time column (timelines / event streams), de-duped.
  const orderedDims = panel.timeDimension
    ? [panel.timeDimension, ...dims.filter((d) => d !== panel.timeDimension)]
    : dims;

  const filters: PanelQuery['filters'] = [
    { member: `${panel.view}.${panel.identityKey}`, operator: 'equals', values: idValues },
  ];

  if (panel.needsDateRange) {
    const range = dateRange ?? defaultBehaviorRange(new Date());
    filters.push({
      member: `${panel.view}.log_date`,
      operator: 'inDateRange',
      values: range,
    });
  }

  const q: PanelQuery = { filters };
  if (orderedDims.length > 0) q.dimensions = orderedDims;
  if (measures.length > 0) q.measures = measures;
  if (panel.timeDimension) q.order = { [panel.timeDimension]: 'desc' };
  if (panel.limit != null) q.limit = panel.limit;
  return q;
}
