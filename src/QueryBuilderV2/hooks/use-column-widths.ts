import { useCallback } from 'react';

import { useLocalStorage } from './local-storage';

const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 800;

export type ColumnWidths = Record<string, number>;

export function clampColumnWidth(w: number): number {
  return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, w));
}

export function useColumnWidths(storageKey: string) {
  const [widths, setWidths] = useLocalStorage<ColumnWidths>(storageKey, {});

  const setWidth = useCallback(
    (name: string, w: number) => {
      setWidths({ ...widths, [name]: clampColumnWidth(w) });
    },
    [widths, setWidths]
  );

  const getColumnTemplate = useCallback(
    (
      names: string[],
      overrides?: Record<string, number>,
      fallback = 'minmax(140px, auto)'
    ) =>
      names
        .map((n) => {
          const w = overrides?.[n] ?? widths[n];
          return w != null ? `${w}px` : fallback;
        })
        .join(' '),
    [widths]
  );

  return { widths, setWidth, getColumnTemplate };
}
