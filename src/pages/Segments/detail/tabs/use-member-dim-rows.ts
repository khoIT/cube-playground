/**
 * Fetches preset.memberColumns scoped to a small subset of uids
 * (the visible page on the Members tab). Returns a uid → row map keyed by the
 * preset identity dim so the table can look up dim / measure values per row.
 *
 * Columns can mix `dimension` (flat per-user fields, e.g. `mf_users.country`)
 * and `measure` (per-user aggregates, e.g. `recharge.revenue_vnd`). Both are
 * fetched in a single Cube query — the identity dim sits in `dimensions:`
 * (group key), other dims also in `dimensions:`, measures in `measures:`.
 * Cube returns one row per identity value with all columns populated.
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

export function useMemberDimRows(
  segment: Segment,
  preset: Preset | null,
  uids: string[],
): MemberDimRowsResult {
  const columns = preset?.memberColumns ?? [];
  const identityDim = preset?.identityDim ?? null;

  const query = useMemo<Query | null>(() => {
    if (!identityDim || columns.length === 0 || uids.length === 0) return null;
    const extraDims: string[] = [];
    const measures: string[] = [];
    for (const c of columns) {
      if (c.dimension) extraDims.push(c.dimension);
      else if (c.measure) measures.push(c.measure);
    }
    const q: Query = {
      dimensions: [identityDim, ...extraDims],
      limit: uids.length,
    };
    if (measures.length > 0) q.measures = measures;
    return q;
  }, [identityDim, columns, uids.length]);

  const { rows, loading, error } = useSegmentCubeQuery<Record<string, unknown>>(
    segment,
    query,
    identityDim ?? '',
    { uidsOverride: uids },
  );

  const byUid = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    if (!identityDim) return m;
    for (const r of rows) {
      const key = String(r[identityDim] ?? '');
      if (key) m.set(key, r);
    }
    return m;
  }, [rows, identityDim]);

  return { byUid, loading, error, columns };
}
