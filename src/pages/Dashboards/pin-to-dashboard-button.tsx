/**
 * Toolbar button that opens PinToDashboardModal.
 * Reads current playground query + chart type from QueryBuilderContext.
 * Disabled when there is no executed query to pin.
 */

import React, { useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { useQueryBuilderContext } from '../../QueryBuilderV2/context';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { PinToDashboardModal } from './pin-to-dashboard-modal';
import type { VizType } from '../../api/dashboards-client';

function inferVizType(chartType: string | undefined): VizType {
  if (!chartType) return 'table';
  const t = chartType.toLowerCase();
  if (t === 'line' || t === 'area') return 'line';
  if (t === 'bar' || t === 'horizontal_bar') return 'bar';
  if (t === 'number') return 'kpi';
  return 'table';
}

export function PinToDashboardButton() {
  const { executedQuery, chartType } = useQueryBuilderContext();
  const gameId = useActiveGameId();
  const [open, setOpen] = useState(false);

  const canPin = !!executedQuery;
  const queryJson = canPin ? JSON.stringify(executedQuery) : '';
  const vizType = inferVizType(chartType as string | undefined);

  return (
    <>
      <button
        title="Pin to dashboard"
        aria-label="Pin to dashboard"
        disabled={!canPin}
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          background: 'transparent',
          border: '1px solid var(--border-card, #d1d5db)',
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: 12,
          fontWeight: 500,
          cursor: canPin ? 'pointer' : 'not-allowed',
          color: canPin ? 'var(--text-primary, #111)' : 'var(--text-muted, #9ca3af)',
          transition: 'border-color 0.15s, background 0.15s',
        }}
        onMouseEnter={(e) => {
          if (canPin) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover, #f3f4f6)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }}
      >
        <LayoutGrid size={13} strokeWidth={2} />
        Pin
      </button>

      {open && (
        <PinToDashboardModal
          gameId={gameId}
          queryJson={queryJson}
          vizType={vizType}
          onClose={() => setOpen(false)}
          onPinned={() => setOpen(false)}
        />
      )}
    </>
  );
}
