/**
 * Tiny area-sparkline for the Delta headline hero — mirrors the design's trend
 * glyph next to the big number. Pure SVG, no axes; line + area tinted by the
 * swing direction (positive = success, negative = destructive). Values come from
 * the live KPI strip (real series), so this is a faithful trend, not a mock.
 */
import React from 'react';

export function DeltaHeroSparkline({
  values,
  positive,
  width = 320,
  height = 64,
}: {
  values: number[];
  positive: boolean;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 6;

  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - pad - ((v - min) / span) * (height - 2 * pad);

  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const ink = positive ? 'var(--success-ink)' : 'var(--destructive-ink)';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', maxWidth: width, height }}>
      <path d={`${line} L${width} ${height} L0 ${height} Z`} fill={ink} opacity={0.08} />
      <path d={line} fill="none" stroke={ink} strokeWidth={2.5} strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={4} fill={ink} />
    </svg>
  );
}
