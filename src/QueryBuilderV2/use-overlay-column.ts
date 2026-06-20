/**
 * useOverlayColumn — exposes a combined artifact's OVERLAY measure as a per-date
 * lookup so the Results grid can render it as an extra column beside the primary
 * measure. The chart already overlays the two series visually; this makes the
 * underlying numbers readable/diagnosable in the table too.
 *
 * Returns null on every normal builder session (no overlay) so the grid renders
 * exactly as before. The overlay rows are loaded via the same shared, deduped
 * loader the center chart uses (one Cube /load for both surfaces).
 */

import { useMemo } from 'react';
import type { Query } from '@cubejs-client/core';
import { useQueryBuilderContext } from './context';
import { useActiveGameId } from '../components/Header/use-game-context';
import { useOverlayQuery } from './overlay-query-context';
import { useOverlayRows } from './use-overlay-rows';
import { resolveRowKey, type CubeRow } from '../charts/merge-on-date-value';

export interface OverlayColumn {
  /** Overlay measure ref, e.g. "user_recharge_daily.revenue_vnd_total". */
  measure: string;
  /** Date-portion (YYYY-MM-DD) → overlay measure value for that day. */
  valueByDate: Map<string, number>;
  isLoading: boolean;
}

/** First 10 chars of a date value — "2026-06-11T00:00:00.000" → "2026-06-11". */
export function datePortion(value: unknown): string {
  return String(value ?? '').slice(0, 10);
}

/**
 * Pure mapping: build the date→value lookup for the overlay measure from its
 * loaded rows. Keyed by date PORTION so the primary grid's time-dim value
 * (which may carry a time suffix) matches regardless of formatting. Exported
 * for testing; the hook wraps it with loading/context.
 */
export function buildOverlayValueByDate(rows: CubeRow[], overlayQuery: Query): Map<string, number> {
  const measure = (overlayQuery.measures ?? [])[0];
  const valueByDate = new Map<string, number>();
  if (!measure) return valueByDate;
  const timeDim = (overlayQuery.timeDimensions ?? [])[0];
  const dateKey = resolveRowKey(rows, timeDim?.dimension ?? '', timeDim?.granularity);
  const valueKey = resolveRowKey(rows, measure);
  for (const row of rows) {
    const date = datePortion(row[dateKey]);
    const raw = row[valueKey];
    if (date && raw !== undefined && raw !== null) {
      const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
      if (!Number.isNaN(num)) valueByDate.set(date, num);
    }
  }
  return valueByDate;
}

export function useOverlayColumn(): OverlayColumn | null {
  const overlayQuery = useOverlayQuery();
  const { apiToken, apiUrl } = useQueryBuilderContext();
  const gameId = useActiveGameId();
  const overlay = useOverlayRows(overlayQuery, apiUrl ?? null, apiToken ?? null, gameId ?? null);

  return useMemo(() => {
    if (!overlayQuery) return null;
    const measure = (overlayQuery.measures ?? [])[0];
    if (!measure) return null;
    return {
      measure,
      valueByDate: buildOverlayValueByDate(overlay.rows ?? [], overlayQuery),
      isLoading: overlay.isLoading,
    };
  }, [overlayQuery, overlay.rows, overlay.isLoading]);
}
