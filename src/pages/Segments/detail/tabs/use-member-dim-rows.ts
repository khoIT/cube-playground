/**
 * Fetches preset.memberColumns dimensions scoped to a small subset of uids
 * (the visible page on the Members tab). Returns a uid → row map keyed by the
 * preset identity dim so the table can look up dim values per row.
 */

import { useMemo } from 'react';
import type { Query } from '@cubejs-client/core';
import { useSegmentCubeQuery } from '../use-segment-cube-query';
import type { Segment } from '../../../../types/segment-api';
import type { MemberColumnSpec, Preset } from '../../presets/types';

export interface MemberDimRowsResult {
  /** Map of uid → arbitrary dim row from Cube. */
  byUid: Map<string, Record<string, unknown>>;
  loading: boolean;
  error: Error | null;
  /** The active member-column specs (empty when preset has none). */
  columns: MemberColumnSpec[];
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
    return {
      dimensions: [identityDim, ...columns.map((c) => c.dimension)],
      limit: uids.length,
    };
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
