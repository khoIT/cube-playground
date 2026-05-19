/**
 * Row-selection state shared between Playground Results and the push modal.
 * Lives in a module-level singleton (lightweight observable) so the modal can
 * read selected uids without prop-drilling through QueryBuilderResults.
 */

import { useEffect, useState } from 'react';

export interface SelectionSnapshot {
  /** Cube the executed query is anchored on (or null if mixed/unknown). */
  cube: string | null;
  /** Identity field (full member name e.g. "mf_users.user_id") whose values are uids. */
  identityField: string | null;
  /** Set of selected raw values (already stringified). Order is insertion order. */
  uids: string[];
  /** Original Cube Query (filters + dimensions) at the time of selection. */
  cubeQuery: unknown | null;
  /** Selected rows in raw form for the selection summary aggregate. */
  rows: Record<string, unknown>[];
}

const empty: SelectionSnapshot = {
  cube: null,
  identityField: null,
  uids: [],
  cubeQuery: null,
  rows: [],
};

let current: SelectionSnapshot = empty;
const listeners = new Set<(s: SelectionSnapshot) => void>();

function emit() {
  for (const cb of listeners) cb(current);
}

export const segmentSelectionStore = {
  get(): SelectionSnapshot {
    return current;
  },

  set(next: SelectionSnapshot): void {
    current = next;
    emit();
  },

  clear(): void {
    current = empty;
    emit();
  },

  subscribe(cb: (s: SelectionSnapshot) => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

/** React binding: returns the latest snapshot and re-renders on changes. */
export function useSegmentSelection(): SelectionSnapshot {
  const [snapshot, setSnapshot] = useState<SelectionSnapshot>(current);
  useEffect(() => segmentSelectionStore.subscribe(setSnapshot), []);
  return snapshot;
}
