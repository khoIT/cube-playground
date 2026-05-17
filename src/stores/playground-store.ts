import { createContext, useContext } from 'react';
import { createStore, useStore } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ChartType,
  PivotConfig,
  Query,
  ResultSet,
} from '@cubejs-client/core';

// Playground store: holds per-instance QueryBuilder state.
//
// C1 (red team): the playground renders one <QueryBuilder> per query tab.
// A module-level singleton store would collapse those tabs into one shared
// state. The store-factory pattern returns a FRESH store per instance and
// hands it down through context — two QueryBuilders mounted side-by-side
// each construct their own store via `createPlaygroundStore()`.
//
// C3 (red team): `query` is NOT persisted. The URL hash (`?query=…`,
// `#/build?cube=…`) is the source of truth for query state. Persistence is
// limited to `chartType` and `pivotConfig` — user preferences that do not
// affect query identity.

export type PlaygroundState = {
  query: Query | null;
  executedQuery: Query | null;
  resultSet: ResultSet | null;
  sqlQuery: unknown;
  queryDurationMs: number | null;
  chartType: ChartType | null;
  pivotConfig: PivotConfig | null;
  apiToken: string | null;
  apiUrl: string | null;
};

export type PlaygroundActions = {
  setQuery: (query: Query | null) => void;
  setExecutedQuery: (query: Query | null) => void;
  setResultSet: (rs: ResultSet | null) => void;
  setSqlQuery: (sql: unknown) => void;
  setQueryDurationMs: (ms: number | null) => void;
  setChartType: (type: ChartType | null) => void;
  setPivotConfig: (config: PivotConfig | null) => void;
  setApiToken: (token: string | null) => void;
  setApiUrl: (url: string | null) => void;
  reset: () => void;
};

const initialState: PlaygroundState = {
  query: null,
  executedQuery: null,
  resultSet: null,
  sqlQuery: null,
  queryDurationMs: null,
  chartType: null,
  pivotConfig: null,
  apiToken: null,
  apiUrl: null,
};

export const PLAYGROUND_PREFS_KEY = 'gds-cube:playground-prefs';

export type PlaygroundStore = ReturnType<typeof createPlaygroundStore>;

export function createPlaygroundStore() {
  return createStore<PlaygroundState & PlaygroundActions>()(
    persist(
      (set) => ({
        ...initialState,
        setQuery: (query) =>
          set({ query, executedQuery: null, resultSet: null }),
        setExecutedQuery: (executedQuery) => set({ executedQuery }),
        setResultSet: (resultSet) => set({ resultSet }),
        setSqlQuery: (sqlQuery) => set({ sqlQuery }),
        setQueryDurationMs: (queryDurationMs) => set({ queryDurationMs }),
        setChartType: (chartType) => set({ chartType }),
        setPivotConfig: (pivotConfig) => set({ pivotConfig }),
        setApiToken: (apiToken) => set({ apiToken }),
        setApiUrl: (apiUrl) => set({ apiUrl }),
        reset: () => set({ ...initialState }),
      }),
      {
        name: PLAYGROUND_PREFS_KEY,
        // C3: only user preferences are persisted. `query` is URL-driven.
        partialize: (s) => ({
          chartType: s.chartType,
          pivotConfig: s.pivotConfig,
        }),
        // C3 defense in depth: even if the localStorage payload is hand-
        // crafted to include other fields, hydration ONLY accepts the two
        // allow-listed preference slices. The URL stays the source of truth
        // for `query`.
        merge: (persistedState, currentState) => {
          const safe = (persistedState ?? {}) as Partial<PlaygroundState>;
          return {
            ...currentState,
            chartType:
              safe.chartType !== undefined ? safe.chartType : currentState.chartType,
            pivotConfig:
              safe.pivotConfig !== undefined
                ? safe.pivotConfig
                : currentState.pivotConfig,
          };
        },
      }
    )
  );
}

export const PlaygroundStoreContext = createContext<PlaygroundStore | null>(
  null
);

export function usePlaygroundStore<T>(
  selector: (s: PlaygroundState & PlaygroundActions) => T
): T {
  const store = useContext(PlaygroundStoreContext);
  if (!store) {
    throw new Error(
      'usePlaygroundStore must be used inside <PlaygroundStoreContext.Provider>'
    );
  }
  return useStore(store, selector);
}
