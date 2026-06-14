/**
 * Lightweight inline-SVG trend charts for the Ops Console (no chart-lib dep).
 *  - OpsLineTrend: one or more line series with a value Y-axis (units shown) and
 *    a date X-axis. A second series can ride a right-hand axis when its unit
 *    differs (e.g. paying users on a count axis vs cash on a ₫ axis).
 *  - OpsStackedTrend: per-day stacked bars (e.g. gateway mix) on a ₫ axis.
 * Axis labels are HTML (kept crisp) framing an SVG plot that stretches to fill
 * its column; gridlines mark max / mid / 0. Tokens only.
 */
import React from 'react';
import { formatVnd, formatCompact } from './ops-format';

const VB_W = 600;
const VB_H = 140;
const PAD_X = 4;
const PAD_Y = 8;
const PLOT_H = 128; // rendered pixel height of the plot area
const AXIS_W = 46; // width reserved for a value axis column

export interface TrendSeries {
  label: string;
  color: string;
  values: number[];
  /** Which value axis this series is scaled against. Defaults to 'left'. */
  axis?: 'left' | 'right';
}

/** 'YYYY-MM-DD' → 'M/D' for compact x-axis ticks. */
function shortDay(d: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(d);
  return m ? `${parseInt(m[1], 10)}/${parseInt(m[2], 10)}` : d;
}

function pathFor(values: number[], max: number): string {
  if (values.length === 0) return '';
  const n = values.length;
  const dx = n > 1 ? (VB_W - PAD_X * 2) / (n - 1) : 0;
  const span = VB_H - PAD_Y * 2;
  return values
    .map((v, i) => {
      const x = PAD_X + i * dx;
      const y = VB_H - PAD_Y - (max > 0 ? v / max : 0) * span;
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
          gap: 8,
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {items.map((it) => (
        <span
          key={it.label}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text-muted)' }}
        >
          <span style={{ width: 10, height: 3, borderRadius: 2, background: it.color, flexShrink: 0 }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** Vertical value axis: max / mid / 0, formatted with units. */
function ValueAxis({
  max,
  format,
  side,
}: {
  max: number;
  format: (n: number) => string;
  side: 'left' | 'right';
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        height: PLOT_H,
        width: AXIS_W,
        flexShrink: 0,
        textAlign: side === 'left' ? 'right' : 'left',
        padding: side === 'left' ? '0 6px 0 0' : '0 0 0 6px',
        fontSize: 9.5,
        lineHeight: 1,
        color: 'var(--text-muted)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <span>{format(max)}</span>
      <span>{format(max / 2)}</span>
      <span>0</span>
    </div>
  );
}

/** Date axis: first / mid / last, aligned under the plot column. */
function DateAxis({ dates, leftPad, rightPad }: { dates: string[]; leftPad: number; rightPad: number }) {
  if (dates.length === 0) return null;
  const first = dates[0];
  const last = dates[dates.length - 1];
  const mid = dates[Math.floor((dates.length - 1) / 2)];
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: 6,
        paddingLeft: leftPad,
        paddingRight: rightPad,
        fontSize: 9.5,
        color: 'var(--text-muted)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <span>{shortDay(first)}</span>
      {dates.length > 2 && <span>{shortDay(mid)}</span>}
      <span>{shortDay(last)}</span>
    </div>
  );
}

/** SVG plot area with max/mid/0 gridlines; children draw on top. */
function Plot({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width="100%"
      height={PLOT_H}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      {[0, 0.5, 1].map((t) => {
        const y = PAD_Y + t * (VB_H - PAD_Y * 2);
        return (
          <line
            key={t}
            x1={PAD_X}
            y1={y}
            x2={VB_W - PAD_X}
            y2={y}
            stroke="var(--border-card)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {children}
    </svg>
  );
}

export function OpsLineTrend({
  title,
  dates,
  series,
}: {
  title: string;
  dates: string[];
  series: TrendSeries[];
}) {
  const empty = series.every((s) => s.values.length === 0);
  const rightSeries = series.filter((s) => s.axis === 'right');
  const leftSeries = series.filter((s) => (s.axis ?? 'left') === 'left');
  const leftMax = Math.max(1, ...leftSeries.flatMap((s) => s.values));
  const rightMax = Math.max(1, ...rightSeries.flatMap((s) => s.values));
  const hasRight = rightSeries.length > 0;

  return (
    <ChartFrame
      title={title}
      legend={
        series.length > 1 ? <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} /> : undefined
      }
    >
      {empty ? (
        <EmptyState />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'stretch' }}>
            <ValueAxis max={leftMax} format={formatVnd} side="left" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Plot>
                {series.map((s) => (
                  <path
                    key={s.label}
                    d={pathFor(s.values, s.axis === 'right' ? rightMax : leftMax)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </Plot>
            </div>
            {hasRight && <ValueAxis max={rightMax} format={formatCompact} side="right" />}
          </div>
          <DateAxis dates={dates} leftPad={AXIS_W} rightPad={hasRight ? AXIS_W : 0} />
        </>
      )}
    </ChartFrame>
  );
}

export function OpsStackedTrend({
  title,
  categories,
  days,
  dates,
}: {
  title: string;
  categories: { key: string; color: string }[];
  /** One entry per day: a map of category-key → value. */
  days: Record<string, number>[];
  dates: string[];
}) {
  const totals = days.map((d) => categories.reduce((sum, c) => sum + (d[c.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const n = days.length;
  const slot = n > 0 ? (VB_W - PAD_X * 2) / n : 0;
  const barW = Math.max(1, slot * 0.7);
  const span = VB_H - PAD_Y * 2;

  return (
    <ChartFrame title={title} legend={<Legend items={categories.map((c) => ({ label: c.key, color: c.color }))} />}>
      {n === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'stretch' }}>
            <ValueAxis max={max} format={formatVnd} side="left" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Plot>
                {days.map((d, i) => {
                  const x = PAD_X + i * slot + (slot - barW) / 2;
                  let yCursor = VB_H - PAD_Y;
                  return (
                    <g key={i}>
                      {categories.map((c) => {
                        const v = d[c.key] ?? 0;
                        const h = (v / max) * span;
                        yCursor -= h;
                        return <rect key={c.key} x={x} y={yCursor} width={barW} height={h} fill={c.color} />;
                      })}
                    </g>
                  );
                })}
              </Plot>
            </div>
          </div>
          <DateAxis dates={dates} leftPad={AXIS_W} rightPad={0} />
        </>
      )}
    </ChartFrame>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        height: PLOT_H,
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
