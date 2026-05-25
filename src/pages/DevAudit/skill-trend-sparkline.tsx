/**
 * SkillTrendSparkline — pure-SVG mini sparkline for per-skill daily usage trend.
 *
 * No external chart lib. Renders a single polyline scaled to data range.
 * If all values are zero or data is empty, renders a flat baseline.
 */

import React from 'react';
import { T } from '../../shell/theme';

interface Props {
  /** Daily counts array; index 0 = oldest day, last = today. */
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export function SkillTrendSparkline({
  data,
  width = 60,
  height = 18,
  color = T.brand,
}: Props) {
  // Guard: empty or single-point data → flat baseline
  if (data.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        style={{ display: 'inline-block', verticalAlign: 'middle' }}
      >
        <line x1={0} y1={height - 2} x2={width} y2={height - 2} stroke={color} strokeWidth={1} opacity={0.3} />
      </svg>
    );
  }

  const maxVal = Math.max(1, ...data); // guard div/zero
  const n = data.length;
  const pad = 2; // vertical padding so the line isn't clipped at edges

  // Map data index → SVG coordinate
  function toX(i: number): number {
    if (n === 1) return width / 2;
    return (i / (n - 1)) * width;
  }
  function toY(v: number): number {
    // Invert: 0 → bottom, maxVal → top (with padding)
    return height - pad - (v / maxVal) * (height - pad * 2);
  }

  const total = data.reduce((s, v) => s + v, 0);

  // Single-point: a polyline of one point renders nothing; use a circle instead
  if (data.length === 1) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        style={{ display: 'inline-block', verticalAlign: 'middle' }}
      >
        <title>{`${total} total`}</title>
        <circle cx={width / 2} cy={toY(data[0])} r={1.5} fill={color} />
      </svg>
    );
  }

  const points = data.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      <title>{`${total} total`}</title>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
