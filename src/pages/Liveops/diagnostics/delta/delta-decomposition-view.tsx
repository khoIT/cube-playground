/**
 * Delta decomposition view (Diagnostics tab 1).
 *
 * "Why did it move?" — choose a KPI, a decompose-by dimension, and a period
 * comparison; the backend returns each segment's contribution to the headline
 * swing. Renders a contribution waterfall + a ranked contributor table with
 * Explore deep-links. Descriptive attribution, not a forecast. Design tokens only.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, MessageSquareText } from 'lucide-react';
import { useGameContext } from '../../../../components/Header/use-game-context';
import { formatVnd, formatInt, formatCompact, formatPct } from '../../../OpsConsole/ops-format';
import { ContributionWaterfall } from './contribution-waterfall';
import { useDeltaDecomposition } from './use-delta-decomposition';
import {
  DELTA_MEASURES,
  DELTA_DIMENSIONS,
  DELTA_TIME_DIMENSION,
  buildPeriods,
  type DeltaPeriodPreset,
} from './delta-config';
import type { DeltaContributor } from './decompose-api';

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-xl)',
  padding: 16,
  fontFamily: 'var(--font-sans)',
};

const selectStyle: React.CSSProperties = {
  appearance: 'none',
  padding: '7px 12px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-strong)',
  background: 'var(--bg-card)',
  color: 'var(--text-primary)',
  fontSize: 13,
  fontWeight: 500,
  fontFamily: 'var(--font-sans)',
  cursor: 'pointer',
};

function exploreUrl(measure: string, dimension: string, value: string, periodB: [string, string]): string {
  const query = {
    measures: [measure],
    dimensions: [dimension],
    timeDimensions: [{ dimension: DELTA_TIME_DIMENSION, granularity: 'day', dateRange: periodB }],
    filters: [{ member: dimension, operator: 'equals', values: [value] }],
  };
  return `/build?query=${encodeURIComponent(JSON.stringify(query))}`;
}

export function DeltaDecompositionView() {
  const { gameId } = useGameContext();
  const [measureId, setMeasureId] = React.useState(DELTA_MEASURES[0].id);
  const [dimensionId, setDimensionId] = React.useState(DELTA_DIMENSIONS[1].id);
  const [preset, setPreset] = React.useState<DeltaPeriodPreset>('wow');

  const measure = DELTA_MEASURES.find((m) => m.id === measureId) ?? DELTA_MEASURES[0];
  const periods = React.useMemo(() => buildPeriods(preset), [preset]);

  const request = React.useMemo(
    () => ({
      game: gameId,
      measure: measureId,
      dimension: dimensionId,
      timeDimension: DELTA_TIME_DIMENSION,
      periodA: periods.periodA,
      periodB: periods.periodB,
    }),
    [gameId, measureId, dimensionId, periods],
  );
  const { data, loading, error } = useDeltaDecomposition(request);

  const fmt = (n: number) => (measure.unit === 'vnd' ? formatVnd(n) : formatInt(n));
  const fmtShort = (n: number) => (measure.unit === 'vnd' ? `₫${formatCompact(n)}` : formatCompact(n));

  const up = (data?.headlineDelta ?? 0) >= 0;
  const deltaColor = up ? 'var(--success-ink)' : 'var(--destructive-ink)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={measureId} onChange={(e) => setMeasureId(e.target.value)} style={selectStyle} aria-label="Metric">
          {DELTA_MEASURES.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>by</span>
        <select value={dimensionId} onChange={(e) => setDimensionId(e.target.value)} style={selectStyle} aria-label="Decompose by">
          {DELTA_DIMENSIONS.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
        <div style={{ display: 'inline-flex', gap: 2, padding: 3, background: 'var(--bg-muted)', borderRadius: 'var(--radius-full)' }}>
          {(['wow', 'mom'] as DeltaPeriodPreset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              style={{
                padding: '5px 12px',
                border: 'none',
                borderRadius: 'var(--radius-full)',
                cursor: 'pointer',
                fontSize: 12.5,
                fontWeight: 600,
                fontFamily: 'var(--font-sans)',
                background: preset === p ? 'var(--bg-card)' : 'transparent',
                color: preset === p ? 'var(--brand)' : 'var(--text-muted)',
              }}
            >
              {p === 'wow' ? 'Week / week' : 'Month / month'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ ...card, background: 'var(--destructive-soft)', color: 'var(--destructive-ink)', fontSize: 12.5 }}>
          Couldn’t decompose this metric for {gameId}: {error}
        </div>
      )}

      {/* Headline */}
      <div style={card}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          {measure.label} · {periods.labelB} vs {periods.labelA}
        </div>
        {loading || !data ? (
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>
            {loading ? 'Decomposing…' : 'No data.'}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 26, fontWeight: 700, color: deltaColor }}>
              {up ? '+' : ''}{fmt(data.headlineDelta)}
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: deltaColor }}>
              {data.headlinePct != null ? `${up ? '+' : ''}${formatPct(data.headlinePct, 1)}` : '—'}
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {fmt(data.totalA)} → {fmt(data.totalB)}
            </span>
          </div>
        )}
      </div>

      {/* Waterfall */}
      {data && data.additive && data.contributors.length > 0 && (
        <div style={card}>
          <ContributionWaterfall
            totalA={data.totalA}
            totalB={data.totalB}
            labelA={periods.labelA}
            labelB={periods.labelB}
            steps={data.contributors.map((c) => ({ label: c.value, delta: c.delta }))}
            formatValue={fmtShort}
          />
        </div>
      )}

      {data && !data.additive && (
        <div style={{ ...card, fontSize: 12, color: 'var(--text-muted)' }}>{data.note}</div>
      )}

      {/* Contributor table */}
      {data && data.contributors.length > 0 && (
        <div style={card}>
          <ContributorTable
            contributors={data.contributors}
            measureId={measureId}
            dimensionId={dimensionId}
            periodB={periods.periodB}
            fmt={fmt}
          />
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {data.additive
                ? `Residual ${fmt(data.residual)}${data.bucketedCount > 0 ? ` · ${data.bucketedCount} smaller segments bucketed` : ''}${data.truncated ? ' · high-cardinality: tail beyond top 1000 folded into residual' : ''}`
                : data.note}
            </span>
            <Link
              to="/chat"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--brand)', textDecoration: 'none' }}
            >
              <MessageSquareText size={14} /> Ask in chat
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function ContributorTable({
  contributors,
  measureId,
  dimensionId,
  periodB,
  fmt,
}: {
  contributors: DeltaContributor[];
  measureId: string;
  dimensionId: string;
  periodB: [string, string];
  fmt: (n: number) => string;
}) {
  const th: React.CSSProperties = {
    textAlign: 'right',
    padding: '6px 8px',
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border-card)',
  };
  const td: React.CSSProperties = { textAlign: 'right', padding: '7px 8px', fontSize: 12.5, color: 'var(--text-primary)' };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-sans)' }}>
      <thead>
        <tr>
          <th style={{ ...th, textAlign: 'left' }}>Segment</th>
          <th style={th}>Prior</th>
          <th style={th}>Current</th>
          <th style={th}>Δ</th>
          <th style={th}>% of swing</th>
          <th style={{ ...th, width: 40 }} aria-label="Explore" />
        </tr>
      </thead>
      <tbody>
        {contributors.map((c) => {
          const up = c.delta >= 0;
          return (
            <tr key={c.value}>
              <td style={{ ...td, textAlign: 'left', fontWeight: 500 }}>{c.value || '∅'}</td>
              <td style={td}>{fmt(c.a)}</td>
              <td style={td}>{fmt(c.b)}</td>
              <td style={{ ...td, color: up ? 'var(--success-ink)' : 'var(--destructive-ink)', fontWeight: 600 }}>
                {up ? '+' : ''}{fmt(c.delta)}
              </td>
              <td style={td}>{c.pctOfSwing != null ? formatPct(c.pctOfSwing, 0) : '—'}</td>
              <td style={{ ...td, padding: '7px 4px' }}>
                {!c.isOther && c.value ? (
                  <Link
                    to={exploreUrl(measureId, dimensionId, c.value, periodB)}
                    title={`Explore ${c.value} in Playground`}
                    style={{ color: 'var(--text-muted)', display: 'inline-flex' }}
                  >
                    <ArrowUpRight size={14} />
                  </Link>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
