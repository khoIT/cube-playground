/**
 * Row-selection state for the Playground Results table. Generic over the
 * key extraction strategy:
 *   - Identity-uid mode: rowKey = the uid value pulled from the configured
 *     identity dimension (e.g. mf_users.user_id).
 *   - Expansion mode: rowKey = a stable hash of the row's visible dimension
 *     values (used when the executed query is aggregated and doesn't expose
 *     individual uids; selected cohorts are later expanded via a follow-up
 *     Cube Query at push time).
 *
 * Selection persists across pagination of the same result set and resets when
 * the executed query changes.
 */

import { useEffect, useMemo, useState } from 'react';

export type PageSelectionState = 'all' | 'none' | 'some';

export type RowKey = string;
export type GetRowKey = (row: Record<string, unknown>) => RowKey | null;

export interface ResultsSelectionApi {
  /** Selected row keys (uids in identity mode, row hashes in expansion mode). */
  selectedUids: RowKey[];
  isSelected: (key: RowKey) => boolean;
  toggle: (key: RowKey) => void;
  togglePage: (rows: Record<string, unknown>[]) => void;
  clear: () => void;
  pageState: (rows: Record<string, unknown>[]) => PageSelectionState;
}

export function extractUid(
  row: Record<string, unknown>,
  identityField: string | null,
): string | null {
  if (!identityField) return null;
  const v = row[identityField];
  return v == null ? null : String(v);
}

/**
 * Deterministic, JSON-stable key for an aggregated row, derived from its
 * visible dimension values. Used as the selection key in expansion mode.
 */
export function stableRowHash(
  row: Record<string, unknown>,
  dimNames: string[],
): string | null {
  if (dimNames.length === 0) return null;
  const pairs = dimNames.map((d) => {
    const raw = row[d];
    return [d, raw == null ? null : String(raw)] as const;
  });
  return JSON.stringify(pairs);
}

/**
 * Query shape the inference helpers consume. We accept the executed Cube
 * Query loosely (anything that may carry dimensions/measures/timeDimensions)
 * because cohort-style queries can reference an identity cube via any of
 * those three buckets, not just `dimensions`.
 */
export interface InferenceQueryShape {
  dimensions?: string[];
  measures?: string[];
  timeDimensions?: Array<{ dimension: string }>;
}

/** Unique cube names referenced anywhere in the query (dims + measures + time dims). */
export function referencedCubes(executedQuery: InferenceQueryShape | null): string[] {
  if (!executedQuery) return [];
  const out = new Set<string>();
  const push = (member: string | undefined) => {
    if (!member) return;
    const cube = member.split('.')[0];
    if (cube) out.add(cube);
  };
  (executedQuery.dimensions ?? []).forEach(push);
  (executedQuery.measures ?? []).forEach(push);
  (executedQuery.timeDimensions ?? []).forEach((td) => push(td.dimension));
  return Array.from(out);
}

export function inferCubeAndIdentity(
  executedQuery: InferenceQueryShape | null,
  hasIdentityFor: (cube: string) => boolean,
  identityFieldFor: (cube: string) => string | null,
): { cube: string | null; identityField: string | null } {
  if (!executedQuery?.dimensions?.length) return { cube: null, identityField: null };
  for (const dim of executedQuery.dimensions) {
    const cube = dim.split('.')[0];
    if (hasIdentityFor(cube) && identityFieldFor(cube) === dim) {
      return { cube, identityField: dim };
    }
  }
  return { cube: null, identityField: null };
}

/**
 * Detects the case where the query targets a cube that HAS a configured
 * identity field, but the executed dimensions don't include that field —
 * i.e. the result rows are aggregated and don't carry per-user ids. Returns
 * the cube + missing identity field so the UI can offer the expansion path.
 *
 * The cube reference can come from any of `dimensions`, `measures`, or
 * `timeDimensions` — cohort queries commonly bucket on a time dimension and
 * surface metrics without listing any plain dimension at all.
 */
export function inferIdentityGap(
  executedQuery: InferenceQueryShape | null,
  hasIdentityFor: (cube: string) => boolean,
  identityFieldFor: (cube: string) => string | null,
): { cube: string; identityField: string } | null {
  const cubes = referencedCubes(executedQuery);
  if (cubes.length === 0) return null;
  const matched = inferCubeAndIdentity(executedQuery, hasIdentityFor, identityFieldFor);
  if (matched.identityField) return null;
  for (const cube of cubes) {
    const field = identityFieldFor(cube);
    if (hasIdentityFor(cube) && field) {
      return { cube, identityField: field };
    }
  }
  return null;
}

/**
 * Returns a stable selection API keyed by row key. The reset effect fires
 * whenever the executed query payload changes — its JSON serialization makes
 * change detection deterministic across renders.
 */
export function useResultsSelection(
  executedQuery: unknown,
  getRowKey: GetRowKey,
): ResultsSelectionApi {
  const [selected, setSelected] = useState<Set<RowKey>>(() => new Set());

  const queryKey = useMemo(() => JSON.stringify(executedQuery ?? null), [executedQuery]);

  useEffect(() => {
    setSelected(new Set());
  }, [queryKey]);

  return {
    selectedUids: Array.from(selected),
    isSelected: (key) => selected.has(key),
    toggle: (key) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    togglePage: (rows) =>
      setSelected((prev) => {
        const keys = rows
          .map((r) => getRowKey(r))
          .filter((k): k is RowKey => k != null);
        if (keys.length === 0) return prev;
        const allSelected = keys.every((k) => prev.has(k));
        const next = new Set(prev);
        if (allSelected) {
          keys.forEach((k) => next.delete(k));
        } else {
          keys.forEach((k) => next.add(k));
        }
        return next;
      }),
    clear: () => setSelected(new Set()),
    pageState: (rows) => {
      const keys = rows
        .map((r) => getRowKey(r))
        .filter((k): k is RowKey => k != null);
      if (keys.length === 0) return 'none';
      const count = keys.filter((k) => selected.has(k)).length;
      if (count === 0) return 'none';
      if (count === keys.length) return 'all';
      return 'some';
    },
  };
}
