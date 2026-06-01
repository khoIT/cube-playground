/**
 * Thin React context carrying compare-mode state into the right-pane Compare
 * tab. Kept separate from QueryBuilderContext to avoid touching the shared
 * provider. QueryBuilderInternals writes (state + setter); ComparePane reads
 * the state and calls onCompareChange to switch modes.
 */

import { createContext, useContext } from 'react';

import type { CompareSetting } from './compare-url-codec';
import type { CompareResultsState } from './use-compare-results';

export interface CompareContextValue {
  compareSetting: CompareSetting;
  compareState: CompareResultsState;
  /** Switch compare mode (Off / Prev period / Other game). No-op by default. */
  onCompareChange: (next: CompareSetting) => void;
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
  onCompareChange: () => {},
});

export function useCompareContext(): CompareContextValue {
  return useContext(CompareContext);
}
