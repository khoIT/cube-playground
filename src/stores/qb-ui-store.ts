import { createContext, useContext } from 'react';
import { createStore, useStore } from 'zustand';

// QB-UI store: holds per-instance side-panel UI state.
//
// C1 (red team): each <QueryBuilder> mounts its own store via
// `createQbUiStore()` and provides it via context, mirroring the
// playground-store factory pattern.
//
// Not persisted — UI state is ephemeral. Sets are intentionally NOT JSON-
// serializable, which would conflict with `persist` middleware anyway.

export type ViewMode = 'cubes' | 'views';

export type QbUiState = {
  openCubes: Set<string>;
  viewMode: ViewMode;
  filterString: string;
  scrollToCubeName: string | null;
};

export type QbUiActions = {
  toggleCube: (name: string) => void;
  openCube: (name: string) => void;
  closeCube: (name: string) => void;
  setViewMode: (mode: ViewMode) => void;
  setFilterString: (value: string) => void;
  setScrollToCubeName: (name: string | null) => void;
  reset: () => void;
};

const initialState: QbUiState = {
  openCubes: new Set(),
  viewMode: 'cubes',
  filterString: '',
  scrollToCubeName: null,
};

export type QbUiStore = ReturnType<typeof createQbUiStore>;

export function createQbUiStore() {
  return createStore<QbUiState & QbUiActions>()((set) => ({
    ...initialState,
    toggleCube: (name) =>
      set((s) => {
        const next = new Set(s.openCubes);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return { openCubes: next };
      }),
    openCube: (name) =>
      set((s) => {
        if (s.openCubes.has(name)) return {};
        const next = new Set(s.openCubes);
        next.add(name);
        return { openCubes: next };
      }),
    closeCube: (name) =>
      set((s) => {
        if (!s.openCubes.has(name)) return {};
        const next = new Set(s.openCubes);
        next.delete(name);
        return { openCubes: next };
      }),
    setViewMode: (viewMode) => set({ viewMode }),
    setFilterString: (filterString) => set({ filterString }),
    setScrollToCubeName: (scrollToCubeName) => set({ scrollToCubeName }),
    reset: () => set({ ...initialState, openCubes: new Set() }),
  }));
}

export const QbUiStoreContext = createContext<QbUiStore | null>(null);

export function useQbUiStore<T>(selector: (s: QbUiState & QbUiActions) => T): T {
  const store = useContext(QbUiStoreContext);
  if (!store) {
    throw new Error(
      'useQbUiStore must be used inside <QbUiStoreContext.Provider>'
    );
  }
  return useStore(store, selector);
}
