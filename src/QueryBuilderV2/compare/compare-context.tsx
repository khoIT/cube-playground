/**
 * Thin React context carrying compare-mode state into QueryBuilderResults.
 *
 * Kept separate from QueryBuilderContext to avoid touching the shared
 * provider (Phase 4 file ownership). Only QueryBuilderInternals writes;
 * QueryBuilderResults reads.
 */

import { createContext, useContext } from 'react';

import type { CompareSetting } from './compare-url-codec';
import type { CompareResultsState } from './use-compare-results';

export interface CompareContextValue {
  compareSetting: CompareSetting;
  compareState: CompareResultsState;
}

const DEFAULT_COMPARE_STATE: CompareResultsState = {
  mergedRows: null,
  isLoading: false,
  error: null,
  compLabel: '',
  unavailableMeasures: [],
};

export const CompareContext = createContext<CompareContextValue>({
  compareSetting: null,
  compareState: DEFAULT_COMPARE_STATE,
});

export function useCompareContext(): CompareContextValue {
  return useContext(CompareContext);
}
