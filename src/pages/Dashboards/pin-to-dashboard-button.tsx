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
import type { ChartType, VizType } from '../../api/dashboards-client';

function inferVizType(chartType: string | undefined): VizType {
  if (!chartType) return 'table';
  const t = chartType.toLowerCase();
  if (t === 'line' || t === 'area') return 'line';
  if (t === 'bar' || t === 'horizontal_bar') return 'bar';
  if (t === 'number') return 'kpi';
  return 'table';
}

// The persisted chart_type keeps the exact playground chart; viz_type stays the
// coarse fallback for legacy/KPI rendering.
const CHART_TYPES: ChartType[] = ['line', 'bar', 'area', 'table', 'number', 'pie'];
function toChartType(chartType: string | undefined): ChartType | undefined {
  if (!chartType) return undefined;
  const t = chartType.toLowerCase();
  return (CHART_TYPES as string[]).includes(t) ? (t as ChartType) : undefined;
}

export function PinToDashboardButton() {
  const { executedQuery, chartType, pivotConfig } = useQueryBuilderContext();
  const gameId = useActiveGameId();
  const [open, setOpen] = useState(false);

  const canPin = !!executedQuery;
  const queryJson = canPin ? JSON.stringify(executedQuery) : '';
  const vizType = inferVizType(chartType as string | undefined);
  const fullChartType = toChartType(chartType as string | undefined);
  const pivotConfigJson = pivotConfig ? JSON.stringify(pivotConfig) : undefined;

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
          border: '1px solid var(--border-card)',
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: 12,
          fontWeight: 500,
          cursor: canPin ? 'pointer' : 'not-allowed',
          color: canPin ? 'var(--text-primary)' : 'var(--text-muted)',
          transition: 'border-color 0.15s, background 0.15s',
        }}
        onMouseEnter={(e) => {
          if (canPin) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-muted)';
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
          chartType={fullChartType}
          pivotConfigJson={pivotConfigJson}
          onClose={() => setOpen(false)}
          onPinned={() => setOpen(false)}
        />
      )}
    </>
  );
}
