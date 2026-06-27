/**
 * Admin-only consumption view for a served segment (Concept E): how the contract
 * is actually pulled. Summary tiles → (daily-pulls-by-key chart + outcome health)
 * → per-page pull log with CSV export. Non-admin viewers get a 403 from the
 * endpoint and this renders nothing.
 *
 * The daily chart REUSES AssistantChartSection (the same renderer /ops uses) by
 * shaping the rollup into a stacked-bar ChartArtifact — no bespoke chart code.
 */

import { ReactElement, useEffect, useMemo, useState } from 'react';
import { segmentsClient } from '../../../../../../api/segments-client';
import { SegmentApiError } from '../../../../../../api/api-client';
import type { SegmentConsumption } from '../../../../../../types/segment-api';
import type { ChartArtifact } from '../../../../../../api/chat-sse-client';
import { AssistantChartSection } from '../../../../../chat/components/assistant-chart-section';
import { ConsumptionSummaryStrip } from './consumption-summary-strip';
import { ConsumptionHealthPanel } from './consumption-health-panel';
import { PullLogTable } from './pull-log-table';

type Window = '24h' | '7d' | '30d';

export function ConsumptionView({ segmentId }: { segmentId: string }): ReactElement | null {
  const [window, setWindow] = useState<Window>('7d');
  const [data, setData] = useState<SegmentConsumption | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    segmentsClient
      .getConsumption(segmentId, window)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof SegmentApiError && err.status === 403) setForbidden(true);
      });
    return () => {
      cancelled = true;
    };
  }, [segmentId, window]);

  const chart = useMemo<ChartArtifact | null>(() => {
    if (!data || data.dailyByKey.length === 0) return null;
    const labelByKey = new Map(data.byKey.map((k) => [k.keyId, k.label]));
    const chartData = data.dailyByKey.map((d) => ({
      date: d.date,
      pulls: d.pulls,
      key: labelByKey.get(d.keyId) ?? `${d.keyId.slice(0, 8)}…`,
    }));
    return {
      id: `consumption-${segmentId}-${window}`,
      spec: {
        type: 'stacked-bar',
        title: 'Daily pulls by key',
        data: chartData,
        encoding: { category: 'date', value: 'pulls', series: 'key' },
      },
      truncated: false,
      originalRowCount: chartData.length,
    };
  }, [data, segmentId, window]);

  // Non-admin → endpoint 403 → hide the whole section (the activation tab still
  // shows the contract banner; consumption is governance-gated).
  if (forbidden) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Consumption</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 0, border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md, 8px)', overflow: 'hidden' }}>
          {(['24h', '7d', '30d'] as Window[]).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWindow(w)}
              style={{
                padding: '3px 12px',
                fontSize: 12,
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: window === w ? 'var(--brand)' : 'var(--bg-card)',
                color: window === w ? '#fff' : 'var(--text-muted)',
              }}
            >
              {w}
            </button>
          ))}
        </span>
      </div>

      {data == null ? (
        <div style={{ height: 80 }} />
      ) : (
        <>
          <ConsumptionSummaryStrip summary={data.summary} />
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
            <div style={{ minWidth: 0 }}>
              {chart ? (
                <AssistantChartSection artifact={chart} defaultView="chart" />
              ) : (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg, 10px)', padding: 16, fontSize: 12.5, color: 'var(--text-muted)' }}>
                  No pull activity in this window yet.
                </div>
              )}
            </div>
            <ConsumptionHealthPanel breakdown={data.statusBreakdown} />
          </div>
          <PullLogTable segmentId={segmentId} initial={data.recentPulls} initialCursor={data.recentCursor} />
        </>
      )}
    </div>
  );
}
