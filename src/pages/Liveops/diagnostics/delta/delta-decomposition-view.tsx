/**
 * Delta decomposition view (Diagnostics tab 1).
 *
 * "Why did it move?" — pick a KPI, a decompose-by dimension, and a period
 * comparison; the backend returns each segment's contribution to the headline
 * swing. Renders a headline hero (with a live trend sparkline), a contribution
 * waterfall, and a ranked contributor list with Explore deep-links.
 *
 * The KPI row carries the full product vision (DAU · Revenue · Payer rate · D7
 * retention) but only additive measures can be honestly waterfall-decomposed —
 * the non-additive ones render as DISABLED tabs with the reason on hover. Revenue
 * is the fully-wired path. Descriptive attribution, not a forecast. Tokens only.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronDown } from 'lucide-react';
import { useGameContext } from '../../../../components/Header/use-game-context';
import { useLiveKpis } from '../../use-live-kpis';
import { formatVnd, formatInt, formatCompact, formatPct } from '../../../OpsConsole/ops-format';
import { ContributionWaterfall } from './contribution-waterfall';
import { ContributorRankedList } from './contributor-ranked-list';
import { DeltaHeroSparkline } from './delta-hero-sparkline';
import { useDeltaDecomposition } from './use-delta-decomposition';
import {
  DELTA_MEASURES,
  DELTA_DIMENSIONS,
  DELTA_TIME_DIMENSION,
  buildPeriods,
  type DeltaPeriodPreset,
} from './delta-config';

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-xl)',
  padding: 16,
  fontFamily: 'var(--font-sans)',
};

const selectStyle: React.CSSProperties = {
  appearance: 'none',
  padding: '7px 30px 7px 12px', // right room for the chevron affordance
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-strong)',
  background: 'var(--bg-card)',
  color: 'var(--text-primary)',
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'var(--font-sans)',
  cursor: 'pointer',
  width: '100%',
};

const DEFAULT_MEASURE = DELTA_MEASURES.find((m) => m.available) ?? DELTA_MEASURES[0];

export function DeltaDecompositionView() {
  const { gameId } = useGameContext();
  const [measureId, setMeasureId] = React.useState(DEFAULT_MEASURE.id);
  const [dimensionId, setDimensionId] = React.useState(DELTA_DIMENSIONS[0].id);
  const [preset, setPreset] = React.useState<DeltaPeriodPreset>('wow');

  const measure = DELTA_MEASURES.find((m) => m.id === measureId) ?? DEFAULT_MEASURE;
  const periods = React.useMemo(() => buildPeriods(preset), [preset]);

  // Live trend sparkline for the hero — sourced from the KPI strip (real series).
  const { tiles } = useLiveKpis(gameId);
  const sparkline = measure.sparkTile ? (tiles.find((t) => t.id === measure.sparkTile)?.sparkline ?? []) : [];

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 16 }}>
      {/* KPI tabs + decompose-by + period */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'inline-flex', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {DELTA_MEASURES.map((m, i) => {
            const active = m.id === measureId;
            return (
              <button
                key={m.id}
                type="button"
                disabled={!m.available}
                title={m.available ? undefined : m.unavailableReason}
                onClick={() => m.available && setMeasureId(m.id)}
                style={{
                  padding: '6px 13px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  fontFamily: 'var(--font-sans)',
                  border: 'none',
                  borderLeft: i === 0 ? 'none' : '1px solid var(--border-card)',
                  background: active ? 'var(--brand)' : 'var(--bg-card)',
                  color: active ? 'var(--text-on-brand)' : 'var(--text-muted)',
                  opacity: m.available ? 1 : 0.45,
                  cursor: m.available ? 'pointer' : 'not-allowed',
                }}
              >
                {m.label}
                {!m.available && ' · n/a'}
              </button>
            );
          })}
        </div>

        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>by</span>
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <select value={dimensionId} onChange={(e) => setDimensionId(e.target.value)} style={selectStyle} aria-label="Decompose by">
            {DELTA_DIMENSIONS.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
          <ChevronDown
            size={15}
            aria-hidden
            style={{ position: 'absolute', right: 10, color: 'var(--text-muted)', pointerEvents: 'none' }}
          />
        </div>

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

      {/* Headline hero */}
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
        <HeroStat label={`${measure.label} — ${periods.labelB.toLowerCase()}`}>
          {loading || !data ? '…' : fmt(data.totalB)}
        </HeroStat>
        <Sep />
        <HeroStat label={`Change ${preset === 'wow' ? 'WoW' : 'MoM'}`} color={data ? deltaColor : undefined}>
          {loading || !data ? '…' : `${up ? '+' : ''}${fmt(data.headlineDelta)}`}
        </HeroStat>
        <Sep />
        <HeroStat label="% change" color={data ? deltaColor : undefined}>
          {loading || !data ? '…' : data.headlinePct != null ? `${up ? '+' : ''}${formatPct(data.headlinePct, 1)}` : '—'}
        </HeroStat>
        {sparkline.length >= 2 && (
          <div style={{ flex: 1, minWidth: 180 }}>
            <DeltaHeroSparkline values={sparkline} positive={up} />
          </div>
        )}
      </div>

      {/* Waterfall + ranked contributors side-by-side */}
      {data && data.contributors.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 16 }}>
          <div style={card}>
            <CardHead title="Contribution waterfall" meta={`${periods.labelA.toLowerCase()} → ${periods.labelB.toLowerCase()}, by driver`} />
            {data.additive ? (
              <ContributionWaterfall
                totalA={data.totalA}
                totalB={data.totalB}
                labelA={periods.labelA}
                labelB={periods.labelB}
                steps={data.contributors.map((c) => ({ label: c.value, delta: c.delta }))}
                formatValue={fmtShort}
              />
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '8px 4px' }}>{data.note}</div>
            )}
          </div>

          <div style={card}>
            <CardHead title="Top contributors" meta="ranked by share of swing" />
            <ContributorRankedList
              contributors={data.contributors}
              measureId={measureId}
              dimensionId={dimensionId}
              periodB={periods.periodB}
              fmt={fmt}
            />
            <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 12, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
              <CalendarClock size={13} style={{ marginTop: 1, flexShrink: 0, color: 'var(--brand)' }} />
              <span>
                Cross-check the biggest mover against the{' '}
                <Link to="/liveops/diagnostics?tab=timeline" style={{ color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}>
                  Event timeline
                </Link>{' '}
                — a patch, campaign or incident may line up with the swing.
              </span>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
              {data.additive
                ? `Residual ${fmt(data.residual)}${data.bucketedCount > 0 ? ` · ${data.bucketedCount} smaller segments bucketed` : ''}${data.truncated ? ' · tail beyond top 1000 folded into residual' : ''}`
                : data.note}
            </div>
          </div>
        </div>
      )}

      {/* Descriptive-attribution disclaimer */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
          background: 'var(--warning-soft)',
          border: '1px solid var(--warning-ink)',
          borderRadius: 'var(--radius-md)',
          padding: '9px 12px',
          fontSize: 12,
          color: 'var(--warning-ink)',
          lineHeight: 1.45,
        }}
      >
        <span aria-hidden>⚠</span>
        <span>
          Decomposition is descriptive attribution over existing cubes (mix-shift + level effects) — it explains{' '}
          <b>where</b> the change concentrated, not a causal forecast.
        </span>
      </div>
    </div>
  );
}

function HeroStat({ label, color, children }: { label: string; color?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1, color: color ?? 'var(--text-primary)' }}>
        {children}
      </div>
    </div>
  );
}

function Sep() {
  return <div style={{ width: 1, alignSelf: 'stretch', minHeight: 40, background: 'var(--border-card)' }} />;
}

function CardHead({ title, meta }: { title: string; meta: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{meta}</span>
    </div>
  );
}
