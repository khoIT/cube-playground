/**
 * Build the Cube query for one 360 panel from its config + the per-member
 * identity values (+ a date window for behavior panels).
 *
 * Dimension/measure split is taken from the pre-classified config (Cube rejects
 * a measure in `dimensions:`). Timelines and event streams lead with their time
 * column and order it descending. Behavior panels (`needsDateRange`) add an
 * `inDateRange` filter on `<view>.log_date` — the cube.js guardrail counts that
 * as the required ≤31-day bound, so no unbounded scan ever reaches Trino.
 */

import type { Query } from '@cubejs-client/core';
import type { Member360Panel } from './member360-panels';

export type DateRange = [string, string];

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
 * @returns a Cube Query, or null when there's nothing to query (no identity)
 */
export function buildPanelQuery(
  panel: Member360Panel,
  idValues: string[],
  dateRange?: DateRange,
): Query | null {
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

  const filters: NonNullable<Query['filters']> = [
    { member: `${panel.view}.${panel.identityKey}`, operator: 'equals' as never, values: idValues },
  ];

  if (panel.needsDateRange) {
    const range = dateRange ?? defaultBehaviorRange(new Date());
    filters.push({
      member: `${panel.view}.log_date`,
      operator: 'inDateRange' as never,
      values: range,
    });
  }

  const q: Query = { filters };
  if (orderedDims.length > 0) q.dimensions = orderedDims;
  if (measures.length > 0) q.measures = measures;
  if (panel.timeDimension) q.order = { [panel.timeDimension]: 'desc' };
  if (panel.limit != null) q.limit = panel.limit;
  return q;
}
