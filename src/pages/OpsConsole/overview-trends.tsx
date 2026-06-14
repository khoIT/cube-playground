/**
 * Overview trend grid — the interactive charts, laid out MAX 2 per row so each
 * chart's title + axes stay legible (the old 3-up grid cramped them).
 *
 * Row 1: cash daily · paying-users-vs-cash (dual)
 * Row 2: gateway mix (stacked) · ad-spend-vs-cash (dual, ROAS)
 * Row 3: ARPPU & conversion (dual) · support volume & sentiment (dual)
 * Row 4: purchase hour×day-of-week heatmap (full width)
 * Row 5: revenue concentration by payer tier (full width)
 *
 * Each chart reuses the shared chat renderer (type-switch + raw table + CSV) and
 * carries an Open-in-Playground deeplink to the exact feeding query. Split out of
 * overview-tab to keep both files focused.
 */
import React, { useMemo } from 'react';
import { AssistantChartSection } from '../Chat/components/assistant-chart-section';
import {
  lineArtifact,
  dualMeasureArtifact,
  stackedArtifact,
  heatmapArtifact,
  barArtifact,
} from './ops-chart-artifact';
import { OpenInPlayground } from './open-in-playground';
import type { OpsOverviewData } from './use-ops-overview';

/** Placeholder while a trend loads or a window/source returns no rows — the
 *  shared chart renderer needs ≥1 row, so we never mount it empty. */
function TrendPlaceholder({ title, empty, message }: { title: string; empty?: boolean; message?: string }) {
  return (
    <div
      style={{
        width: '100%',
        minHeight: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '0 16px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 12,
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-sans)',
        fontSize: 12.5,
      }}
    >
      {message ?? (empty ? `No data for ${title.toLowerCase()} in this window.` : `Loading ${title.toLowerCase()}…`)}
    </div>
  );
}

export function OverviewTrends({ d, loading }: { d: OpsOverviewData; loading: boolean }) {
  const dates = useMemo(() => d.daily.map((x) => x.date), [d.daily]);

  const cashArtifact = useMemo(
    () =>
      lineArtifact({
        id: 'ops-cash-daily',
        title: 'Cash collected — daily',
        dates,
        valueKey: 'cash_vnd',
        valueLabel: 'Cash collected (₫)',
        values: d.daily.map((x) => x.cash),
      }),
    [dates, d.daily],
  );

  const payersVsCashArtifact = useMemo(
    () =>
      dualMeasureArtifact({
        id: 'ops-payers-vs-cash-daily',
        title: 'Paying users vs cash — daily',
        dates,
        leftKey: 'cash_vnd',
        leftLabel: 'Cash collected (₫)',
        leftValues: d.daily.map((x) => x.cash),
        rightKey: 'payers',
        rightLabel: 'Paying users',
        rightValues: d.daily.map((x) => x.payers),
      }),
    [dates, d.daily],
  );

  const gatewayArtifact = useMemo(
    () =>
      stackedArtifact({
        id: 'ops-gateway-mix',
        title: 'Gateway mix over time',
        dates: d.gatewayDates,
        categories: d.gateways.map((g) => g.key),
        days: d.gatewayDays,
      }),
    [d.gatewayDates, d.gateways, d.gatewayDays],
  );

  const spendVsCashArtifact = useMemo(() => {
    const spendByDate = new Map(d.spendDaily.map((s) => [s.date, s.spend]));
    return dualMeasureArtifact({
      id: 'ops-spend-vs-cash',
      title: 'Ad spend vs cash — daily',
      caption: 'Blended ROAS story — cash collected against marketing spend.',
      dates,
      leftKey: 'cash_vnd',
      leftLabel: 'Cash collected (₫)',
      leftValues: d.daily.map((x) => x.cash),
      rightKey: 'spend_vnd',
      rightLabel: 'Ad spend (₫)',
      rightValues: dates.map((dt) => spendByDate.get(dt) ?? 0),
    });
  }, [dates, d.daily, d.spendDaily]);

  const arppuConversionArtifact = useMemo(
    () =>
      dualMeasureArtifact({
        id: 'ops-arppu-conversion',
        title: 'ARPPU & payer conversion — daily',
        caption: 'ARPPU = cash ÷ payers; conversion = payers ÷ DAU.',
        dates: d.arppuConversionDaily.map((x) => x.date),
        leftKey: 'arppu_vnd',
        leftLabel: 'ARPPU (₫)',
        leftValues: d.arppuConversionDaily.map((x) => x.arppu ?? 0),
        rightKey: 'conversion_pct',
        rightLabel: 'Payer conversion (%)',
        rightValues: d.arppuConversionDaily.map((x) => (x.conversionPct ?? 0) * 100),
      }),
    [d.arppuConversionDaily],
  );

  const csArtifact = useMemo(
    () =>
      dualMeasureArtifact({
        id: 'ops-cs-volume-sentiment',
        title: 'Support — volume & sentiment',
        caption: 'Daily tickets and negative-sentiment count · ~2d warehouse lag.',
        dates: d.csDaily.map((x) => x.date),
        leftKey: 'tickets',
        leftLabel: 'Tickets / day',
        leftValues: d.csDaily.map((x) => x.tickets),
        rightKey: 'negative',
        rightLabel: 'Negative-sentiment tickets',
        rightValues: d.csDaily.map((x) => x.negative),
      }),
    [d.csDaily],
  );

  const heatmap = useMemo(
    () =>
      heatmapArtifact({
        id: 'ops-purchase-heatmap',
        title: 'Purchase intensity — hour × day-of-week',
        caption: 'When players pay — cash summed per hour and weekday over the window.',
        cells: d.heatmap,
      }),
    [d.heatmap],
  );

  const concentrationArtifact = useMemo(
    () =>
      barArtifact({
        id: 'ops-payer-tier-concentration',
        title: 'Revenue concentration by payer tier',
        caption: 'Lifetime value by tier — whales dwarfing the rest is the concentration signal.',
        categoryKey: 'tier',
        categoryLabel: 'Payer tier',
        valueKey: 'ltv_vnd',
        valueLabel: 'Lifetime value (₫)',
        rows: d.payerTiers.map((t) => ({ category: t.tier, value: t.ltv })),
      }),
    [d.payerTiers],
  );

  const hasDaily = dates.length > 0;
  const hasGateway = d.gatewayDates.length > 0 && d.gateways.length > 0;
  const hasArppuConv = d.arppuConversionDaily.length > 0;
  const hasCs = d.csDaily.length > 0;
  const hasHeatmap = d.heatmap.length > 0;
  const hasTiers = d.payerTiers.length > 0;

  const full: React.CSSProperties = { gridColumn: '1 / -1' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
      {/* R1 */}
      {!hasDaily ? (
        <TrendPlaceholder title="Cash collected — daily" empty={!loading} />
      ) : (
        <AssistantChartSection artifact={cashArtifact} defaultView="chart" headerAction={<OpenInPlayground query={d.queries.daily} />} />
      )}
      {!hasDaily ? (
        <TrendPlaceholder title="Paying users vs cash — daily" empty={!loading} />
      ) : (
        <AssistantChartSection artifact={payersVsCashArtifact} defaultView="chart" headerAction={<OpenInPlayground query={d.queries.daily} />} />
      )}

      {/* R2 */}
      {!hasGateway ? (
        <TrendPlaceholder title="Gateway mix over time" empty={!loading} />
      ) : (
        <AssistantChartSection artifact={gatewayArtifact} defaultView="chart" headerAction={<OpenInPlayground query={d.queries.gatewayTrend} />} />
      )}
      {!hasDaily ? (
        <TrendPlaceholder title="Ad spend vs cash — daily" empty={!loading} />
      ) : (
        <AssistantChartSection artifact={spendVsCashArtifact} defaultView="chart" headerAction={<OpenInPlayground query={d.queries.spend} />} />
      )}

      {/* R3 */}
      {!hasArppuConv ? (
        <TrendPlaceholder title="ARPPU & payer conversion — daily" empty={!loading} />
      ) : (
        <AssistantChartSection artifact={arppuConversionArtifact} defaultView="chart" headerAction={<OpenInPlayground query={d.queries.dau} />} />
      )}
      {!hasCs ? (
        <TrendPlaceholder title="Support — volume & sentiment" empty={!loading} />
      ) : (
        <AssistantChartSection artifact={csArtifact} defaultView="chart" headerAction={<OpenInPlayground query={d.queries.cs} />} />
      )}

      {/* R4 — heatmap, full width. Empty is the EXPECTED pre-deploy state (the
          billing timing dims must deploy + the serving instance restart first). */}
      <div style={full}>
        {!hasHeatmap ? (
          <TrendPlaceholder
            title="Purchase intensity"
            message={
              loading
                ? 'Loading purchase intensity…'
                : 'Purchase-timing heatmap populates once the billing hour/day dimensions are deployed.'
            }
          />
        ) : (
          <AssistantChartSection artifact={heatmap} defaultView="chart" headerAction={<OpenInPlayground query={d.queries.heatmap} />} />
        )}
      </div>

      {/* R5 — payer-tier concentration, full width. */}
      <div style={full}>
        {!hasTiers ? (
          <TrendPlaceholder title="Revenue concentration" empty={!loading} />
        ) : (
          <AssistantChartSection artifact={concentrationArtifact} defaultView="chart" headerAction={<OpenInPlayground query={d.queries.payerTiers} />} />
        )}
      </div>
    </div>
  );
}
