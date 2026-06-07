/**
 * Fetches preset.memberColumns scoped to a small subset of uids
 * (the visible page on the Members tab). Returns a uid → row map keyed by the
 * preset identity dim so the table can look up dim / measure values per row.
 *
 * Columns can mix `dimension` (flat per-user fields, e.g. `mf_users.country`)
 * and `measure` (per-user aggregates, e.g. `recharge.revenue_vnd`).
 *
 * Columns are fetched in up to TWO Cube queries:
 *  - base: dims/measures with no time-bound requirement, in a single query —
 *    the identity dim sits in `dimensions:` (group key), other dims also in
 *    `dimensions:`, measures in `measures:`.
 *  - bounded: columns whose spec carries `boundTimeDimension` (behavior/event
 *    cubes whose model REJECTS unbounded queries). These get their own query
 *    with a `timeDimensions` dateRange. Kept separate on purpose: bundling an
 *    event measure unbounded fails the WHOLE query and blanks every column.
 * Rows from both are merged per uid.
 */

import { useMemo } from 'react';
import type { Query } from '@cubejs-client/core';
import { useSegmentCubeQuery } from '../use-segment-cube-query';
import type { Segment } from '../../../../types/segment-api';
import type { MemberColumnSpec, Preset } from '../../presets/types';

export interface MemberDimRowsResult {
  /** Map of uid → arbitrary dim/measure row from Cube. */
  byUid: Map<string, Record<string, unknown>>;
  loading: boolean;
  error: Error | null;
  /** The active member-column specs (empty when preset has none). */
  columns: MemberColumnSpec[];
}

/** Resolves the Cube field name for a column (dim or measure). */
export function memberColumnField(col: MemberColumnSpec): string {
  return col.dimension ?? col.measure ?? '';
}

const DEFAULT_BOUND_RANGE = 'last 30 days';

function buildBaseQuery(
  identityDim: string,
  columns: MemberColumnSpec[],
  uidCount: number,
): Query | null {
  if (columns.length === 0 || uidCount === 0) return null;
  const extraDims: string[] = [];
  const measures: string[] = [];
  for (const c of columns) {
    if (c.dimension) extraDims.push(c.dimension);
    else if (c.measure) measures.push(c.measure);
  }
  const q: Query = { dimensions: [identityDim, ...extraDims], limit: uidCount };
  if (measures.length > 0) q.measures = measures;
  return q;
}

function buildBoundedQuery(
  identityDim: string,
  columns: MemberColumnSpec[],
  uidCount: number,
): Query | null {
  if (columns.length === 0 || uidCount === 0) return null;
  const measures = columns.map((c) => c.measure).filter((m): m is string => !!m);
  if (measures.length === 0) return null;
  // One timeDimensions entry per distinct (dimension, range) pair.
  const seen = new Set<string>();
  const timeDimensions: NonNullable<Query['timeDimensions']> = [];
  for (const c of columns) {
    const dim = c.boundTimeDimension!;
    const range = c.dateRange ?? DEFAULT_BOUND_RANGE;
    const key = `${dim}::${range}`;
    if (seen.has(key)) continue;
    seen.add(key);
    timeDimensions.push({ dimension: dim, dateRange: range as never });
  }
  return { dimensions: [identityDim], measures, timeDimensions, limit: uidCount };
}

export function useMemberDimRows(
  segment: Segment,
  preset: Preset | null,
  uids: string[],
): MemberDimRowsResult {
  const columns = preset?.memberColumns ?? [];
  const identityDim = preset?.identityDim ?? null;

  const baseColumns = columns.filter((c) => !c.boundTimeDimension);
  const boundedColumns = columns.filter((c) => !!c.boundTimeDimension);

  const baseQuery = useMemo<Query | null>(
    () => (identityDim ? buildBaseQuery(identityDim, baseColumns, uids.length) : null),
    [identityDim, columns, uids.length],
  );
  const boundedQuery = useMemo<Query | null>(
    () => (identityDim ? buildBoundedQuery(identityDim, boundedColumns, uids.length) : null),
    [identityDim, columns, uids.length],
  );

  const base = useSegmentCubeQuery<Record<string, unknown>>(
    segment,
    baseQuery,
    identityDim ?? '',
    { uidsOverride: uids },
  );
  const bounded = useSegmentCubeQuery<Record<string, unknown>>(
    segment,
    boundedQuery,
    identityDim ?? '',
    { uidsOverride: uids },
  );

  const byUid = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    if (!identityDim) return m;
    for (const rows of [base.rows, bounded.rows]) {
      for (const r of rows) {
        const key = String(r[identityDim] ?? '');
        if (!key) continue;
        const existing = m.get(key);
        m.set(key, existing ? { ...existing, ...r } : r);
      }
    }
    return m;
  }, [base.rows, bounded.rows, identityDim]);

  return {
    byUid,
    loading: base.loading || bounded.loading,
    // The base columns are the tab's backbone; a failed bounded (event-cube)
    // query degrades to an empty column instead of erroring the whole table.
    error: base.error,
    columns,
  };
}
