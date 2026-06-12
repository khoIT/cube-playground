/**
 * MetricMovementCard — per-(segment, day) metric series over the lakehouse
 * membership snapshots, with the three cohort lenses. Design: user-picked
 * variant B — full-width lens tabs that each carry their one-line semantic,
 * because the whole failure mode of this surface is reading one lens as
 * another (stayers ≠ entry ≠ current).
 *
 * Data: GET /api/segments/:id/eligible-metrics (registry-gated; the card hides
 * itself when the game has no probe-verified marts) and
 * GET /api/segments/:id/metric-series?metric&lens&anchor&days.
 */

import { ReactElement, useEffect, useMemo, useState } from 'react';
import { Select } from 'antd';
import { TrendingUp } from 'lucide-react';
import { apiFetch } from '../../../../api/api-client';
import { CardShell } from './card-shell';
import { useMeasuredWidth } from './use-measured-width';
import { isDemoWeekMode, demoEligibleMetrics, demoMetricSeriesPayload } from './demo-week-mode';
import { fmtCompact } from './trajectory-card-model';
import type { Segment } from '../../../../types/segment-api';

type Lens = 'current' | 'entry' | 'stayers';

interface MetricOption {
  metricKey: string;
  label: string;
  unit: string;
}

interface SeriesPoint {
  date: string;
  value: number;
  memberCount: number;
}

interface SeriesPayload {
  points: SeriesPoint[];
  joinWarning: string | null;
  metric: string;
  label: string;
  unit: string;
  lens: Lens;
  anchor: string | null;
  survivorBiased: boolean;
}

const LENS_TABS: Array<{ key: Lens; title: string; blurb: string; biased?: boolean }> = [
  { key: 'current', title: 'Current members', blurb: 'whoever is in the segment each day — composition moves it' },
  { key: 'entry', title: 'Entry cohort', blurb: 'entered since anchor, tracked even after exit — causal lens' },
  { key: 'stayers', title: 'Stayers', blurb: 'in at anchor ∩ still in — survivor-biased by construction', biased: true },
];

/** Default anchor = 30 days back; entry/stayers need one before they can load. */
function defaultAnchor(): string {
  return new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
}

function SeriesChart({ points, unit }: { points: SeriesPoint[]; unit: string }): ReactElement {
  // Pixel-true (1 SVG unit = 1px, width from the container) — a stretched
  // fixed viewBox scales fonts/dots with the card and breaks on wide layouts.
  const { ref, width: W } = useMeasuredWidth<HTMLDivElement>();
  const H = 180;
  const PAD_L = 52; // gutter for the max-value label
  const PAD_R = 14;
  const maxV = Math.max(1, ...points.map((p) => p.value));
  const maxM = Math.max(1, ...points.map((p) => p.memberCount));
  const minM = Math.min(...points.map((p) => p.memberCount));
  const x = (i: number) => (points.length === 1 ? (PAD_L + W - PAD_R) / 2 : PAD_L + (i * (W - PAD_L - PAD_R)) / (points.length - 1));
  const yV = (v: number) => 12 + (1 - v / maxV) * (H - 44);
  const yM = (m: number) => 12 + (1 - (maxM === minM ? 0.5 : (m - minM) / (maxM - minM))) * (H - 44);

  let vPath = '';
  let mPath = '';
  points.forEach((p, i) => {
    vPath += `${vPath ? ' L' : 'M'}${x(i).toFixed(1)} ${yV(p.value).toFixed(1)}`;
    mPath += `${mPath ? ' L' : 'M'}${x(i).toFixed(1)} ${yM(p.memberCount).toFixed(1)}`;
  });
  const ticks = points.length > 2 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : points.map((_, i) => i);
  const tickAnchor = (i: number) => (i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle');
  return (
    <div ref={ref} style={{ minWidth: 0 }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }} role="img" aria-label={`Metric series (${unit})`}>
        <path d={mPath} fill="none" stroke="var(--chart-2)" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7} />
        <path d={vPath} fill="none" stroke="var(--brand)" strokeWidth={2} />
        {points.length <= 21 && points.map((p, i) => (
          <circle key={p.date} cx={x(i)} cy={yV(p.value)} r={3} fill="var(--brand)" />
        ))}
        <text x={PAD_L - 8} y={yV(maxV) + 3} fontSize={10} fill="var(--text-muted)" textAnchor="end">{fmtCompact(maxV)}</text>
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={H - 4} fontSize={10} fill="var(--text-muted)" textAnchor={tickAnchor(i)}>
            {points[i].date.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function MetricMovementCard({ segment }: { segment: Segment }): ReactElement | null {
  const [metrics, setMetrics] = useState<MetricOption[] | null>(null);
  const [metric, setMetric] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>('current');
  const [anchor, setAnchor] = useState<string>(defaultAnchor());
  const [series, setSeries] = useState<SeriesPayload | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  const isPredicateWithGame = segment.type === 'predicate' && Boolean(segment.game_id);
  const demo = isDemoWeekMode();

  useEffect(() => {
    if (!isPredicateWithGame) return;
    if (demo) {
      const m = demoEligibleMetrics();
      setMetrics(m);
      setMetric((cur) => cur ?? m[0]?.metricKey ?? null);
      return;
    }
    apiFetch<{ metrics: MetricOption[] }>(`/api/segments/${encodeURIComponent(segment.id)}/eligible-metrics`)
      .then((d) => {
        setMetrics(d.metrics);
        setMetric((m) => m ?? d.metrics[0]?.metricKey ?? null);
      })
      .catch(() => setMetrics([]));
  }, [segment.id, isPredicateWithGame, demo]);

  useEffect(() => {
    if (!isPredicateWithGame || !metric) return;
    if (demo) {
      // Temporary preview mode (?demo=1): fixture week instead of Trino reads.
      setSeries(demoMetricSeriesPayload(segment.id, segment.game_id ?? '', metric, lens, anchor) as SeriesPayload);
      setError(null);
      setLoading(false);
      return;
    }
    const params = new URLSearchParams({ metric, lens, days: '90' });
    if (lens !== 'current') params.set('anchor', anchor);
    let alive = true;
    setLoading(true);
    // Drop the previous series immediately — rendering lens A's numbers under
    // lens B's tab while the fetch is in flight is exactly the misread this
    // card's whole design guards against.
    setSeries(null);
    apiFetch<SeriesPayload>(`/api/segments/${encodeURIComponent(segment.id)}/metric-series?${params}`)
      .then((d) => { if (alive) { setSeries(d); setError(null); } })
      .catch((err: Error) => { if (alive) setError(err); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [segment.id, isPredicateWithGame, metric, lens, anchor, demo]);

  const metricOptions = useMemo(
    () => (metrics ?? []).map((m) => ({ value: m.metricKey, label: m.label })),
    [metrics],
  );

  // Registry-gated: games without probe-verified marts get no card at all.
  if (!isPredicateWithGame || (metrics != null && metrics.length === 0)) return null;

  const biased = lens === 'stayers';
  return (
    <CardShell
      title="Metric movement"
      icon={<TrendingUp size={14} />}
      loading={metrics == null}
      skeletonShape="lines"
      cardKey="metric-movement"
      trailing={
        <>
          {demo && (
            <span style={{ background: 'var(--warning-soft)', color: 'var(--warning-ink)', borderRadius: 'var(--radius-full)', padding: '2px 8px', fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
              demo data
            </span>
          )}
          <Select
            size="small"
            style={{ minWidth: 160 }}
            value={metric ?? undefined}
            options={metricOptions}
            onChange={(v) => setMetric(v as string)}
            aria-label="Metric"
          />
          {lens !== 'current' && (
            <input
              type="date"
              value={anchor}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => e.target.value && setAnchor(e.target.value)}
              aria-label="Anchor date"
              style={{
                fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--text-primary)',
                border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)',
                padding: '2px 8px', background: 'var(--bg-card)',
              }}
            />
          )}
        </>
      }
    >
      {/* Lens tabs — each carries its semantic so lenses can't be misread. */}
      <div role="tablist" aria-label="Cohort lens" style={{ display: 'flex', borderBottom: '1px solid var(--border-card)', margin: '0 -2px' }}>
        {LENS_TABS.map((t) => {
          const on = lens === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => setLens(t.key)}
              style={{
                flex: 1, textAlign: 'left', cursor: 'pointer', background: on ? 'var(--brand-soft)' : 'transparent',
                border: 'none', borderBottom: `2px solid ${on ? 'var(--brand)' : 'transparent'}`,
                padding: '8px 12px', fontFamily: 'var(--font-sans)',
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                {t.title}{t.biased ? ' ⚠' : ''}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.35 }}>{t.blurb}</div>
            </button>
          );
        })}
      </div>

      <div style={{ paddingTop: 10 }}>
        {error ? (
          <div style={{ fontSize: 12, color: 'var(--destructive-ink)' }}>{error.message}</div>
        ) : loading && !series ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
        ) : series == null || series.points.length === 0 ? (
          // A dead join (identity-namespace mismatch) surfaces as ZERO points on
          // the entry lens — show the warning, not the benign sparse-data copy.
          series?.joinWarning ? (
            <div style={{ fontSize: 11.5, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)', borderRadius: 'var(--radius-md)', padding: '6px 10px', lineHeight: 1.4 }}>
              {series.joinWarning}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              No data points in this window — snapshots may not cover it yet, or no member had {series?.label ?? 'metric'} activity (sparse days are normal for small segments).
            </div>
          )
        ) : (
          <>
            <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text-muted)', justifyContent: 'flex-end', marginBottom: 2 }}>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--brand)', marginRight: 5, verticalAlign: -1 }} />{series.label}</span>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--chart-2)', marginRight: 5, verticalAlign: -1 }} />members</span>
            </div>
            <SeriesChart points={series.points} unit={series.unit} />
            {series.joinWarning && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)', borderRadius: 'var(--radius-md)', padding: '6px 10px', lineHeight: 1.4 }}>
                {series.joinWarning}
              </div>
            )}
            {biased && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--warning-ink)', background: 'var(--warning-soft)', borderRadius: 'var(--radius-md)', padding: '6px 10px', lineHeight: 1.4 }}>
                ⚠ Survivor-biased: only members still in the segment each day are counted — averages drift up as weak members exit. Use Entry cohort for causal readouts.
              </div>
            )}
          </>
        )}
      </div>
    </CardShell>
  );
}
