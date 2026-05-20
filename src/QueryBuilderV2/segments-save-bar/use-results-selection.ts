/**
 * Row-selection state for the Playground Results table, keyed by the uid
 * value pulled from the configured identity dimension (e.g. mf_users.user_id).
 *
 * Selection persists across pagination of the same result set and resets when
 * the executed query changes.
 */

import { useEffect, useMemo, useState } from 'react';

export type PageSelectionState = 'all' | 'none' | 'some';

export interface ResultsSelectionApi {
  selectedUids: string[];
  isSelected: (uid: string) => boolean;
  toggle: (uid: string) => void;
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

export function inferCubeAndIdentity(
  executedQuery: { dimensions?: string[] } | null,
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
 * Returns a stable selection API keyed by uid. The reset effect fires whenever
 * the executed query payload changes — keeping the dependency on its JSON
 * serialization makes the change detection deterministic across renders.
 */
export function useResultsSelection(
  executedQuery: unknown,
  identityField: string | null,
): ResultsSelectionApi {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const queryKey = useMemo(() => JSON.stringify(executedQuery ?? null), [executedQuery]);

  useEffect(() => {
    setSelected(new Set());
  }, [queryKey, identityField]);

  return {
    selectedUids: Array.from(selected),
    isSelected: (uid) => selected.has(uid),
    toggle: (uid) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(uid)) next.delete(uid);
        else next.add(uid);
        return next;
      }),
    togglePage: (rows) =>
      setSelected((prev) => {
        const uids = rows
          .map((r) => extractUid(r, identityField))
          .filter((u): u is string => u != null);
        if (uids.length === 0) return prev;
        const allSelected = uids.every((u) => prev.has(u));
        const next = new Set(prev);
        if (allSelected) {
          uids.forEach((u) => next.delete(u));
        } else {
          uids.forEach((u) => next.add(u));
        }
        return next;
      }),
    clear: () => setSelected(new Set()),
    pageState: (rows) => {
      const uids = rows
        .map((r) => extractUid(r, identityField))
        .filter((u): u is string => u != null);
      if (uids.length === 0) return 'none';
      const count = uids.filter((u) => selected.has(u)).length;
      if (count === 0) return 'none';
      if (count === uids.length) return 'all';
      return 'some';
    },
  };
}
