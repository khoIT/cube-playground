/**
 * Lightweight inline-SVG trend charts for the Ops Console (no chart-lib dep).
 *  - OpsLineTrend: one or more line series, each normalised to its own max so a
 *    divergence (e.g. payers vs cash) reads on a shared x-axis.
 *  - OpsStackedTrend: per-day stacked bars (e.g. gateway mix over time).
 * Tokens only; geometry mirrors the approved mockup.
 */
import React from 'react';

const VB_W = 600;
const VB_H = 150;
const PAD = 6;

export interface TrendSeries {
  label: string;
  color: string;
  values: number[];
}

function linePath(values: number[]): string {
  if (values.length === 0) return '';
  const max = Math.max(...values, 1);
  const n = values.length;
  const dx = n > 1 ? (VB_W - PAD * 2) / (n - 1) : 0;
  return values
    .map((v, i) => {
      const x = PAD + i * dx;
      const y = VB_H - PAD - (v / max) * (VB_H - PAD * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

interface ChartFrameProps {
  title: string;
  legend?: React.ReactNode;
  children: React.ReactNode;
}

function ChartFrame({ title, legend, children }: ChartFrameProps) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-sm)',
        padding: 16,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>{title}</div>
        {legend}
      </div>
      {children}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {items.map((it) => (
        <span
          key={it.label}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text-muted)' }}
        >
          <span style={{ width: 9, height: 3, borderRadius: 2, background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function OpsLineTrend({ title, series }: { title: string; series: TrendSeries[] }) {
  const empty = series.every((s) => s.values.length === 0);
  return (
    <ChartFrame
      title={title}
      legend={series.length > 1 ? <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} /> : undefined}
    >
      {empty ? (
        <EmptyState />
      ) : (
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height={150} preserveAspectRatio="none">
          {series.map((s) => (
            <path
              key={s.label}
              d={linePath(s.values)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      )}
    </ChartFrame>
  );
}

export function OpsStackedTrend({
  title,
  categories,
  days,
}: {
  title: string;
  categories: { key: string; color: string }[];
  /** One entry per day: a map of category-key → value. */
  days: Record<string, number>[];
}) {
  const totals = days.map((d) => categories.reduce((sum, c) => sum + (d[c.key] ?? 0), 0));
  const max = Math.max(...totals, 1);
  const n = days.length;
  const slot = n > 0 ? (VB_W - PAD * 2) / n : 0;
  const barW = Math.max(1, slot * 0.7);

  return (
    <ChartFrame title={title} legend={<Legend items={categories.map((c) => ({ label: c.key, color: c.color }))} />}>
      {n === 0 ? (
        <EmptyState />
      ) : (
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height={150} preserveAspectRatio="none">
          {days.map((d, i) => {
            const x = PAD + i * slot + (slot - barW) / 2;
            let yCursor = VB_H - PAD;
            return (
              <g key={i}>
                {categories.map((c) => {
                  const v = d[c.key] ?? 0;
                  const h = (v / max) * (VB_H - PAD * 2);
                  yCursor -= h;
                  return <rect key={c.key} x={x} y={yCursor} width={barW} height={h} fill={c.color} />;
                })}
              </g>
            );
          })}
        </svg>
      )}
    </ChartFrame>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        height: 150,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: 12,
      }}
    >
      No data in this window
    </div>
  );
}
