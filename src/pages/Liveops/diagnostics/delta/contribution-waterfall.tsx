/**
 * Contribution waterfall — start (period A total) → per-segment step bars →
 * end (period B total). Step bars rise green / fall red; the axis is BANDED to
 * the cumulative path's own min/max so small steps stay visible against a large
 * base (a 0-based axis would render them as invisible slivers).
 *
 * Additive measures only (the caller gates non-additive out). Hand-rolled SVG —
 * full control over the banded axis + dashed step connectors, matching the
 * approved mockup. Design tokens only.
 */
import React from 'react';

export interface WaterfallStep {
  label: string;
  delta: number;
}

interface ContributionWaterfallProps {
  totalA: number;
  totalB: number;
  labelA: string;
  labelB: string;
  steps: WaterfallStep[];
  formatValue: (n: number) => string;
}

const W = 720;
const H = 300;
const PAD_TOP = 18;
const PAD_BOTTOM = 56;
const PAD_LEFT = 8;
const PAD_RIGHT = 8;

export function ContributionWaterfall({
  totalA,
  totalB,
  labelA,
  labelB,
  steps,
  formatValue,
}: ContributionWaterfallProps) {
  // Build the cumulative path: each bar spans [prevTop, prevTop+delta].
  const cum: number[] = [totalA];
  for (const s of steps) cum.push(cum[cum.length - 1] + s.delta);

  const allPoints = [totalA, totalB, ...cum];
  const rawMin = Math.min(...allPoints);
  const rawMax = Math.max(...allPoints);
  const span = rawMax - rawMin || Math.abs(rawMax) || 1;
  const mn = rawMin - span * 0.08;
  const mx = rawMax + span * 0.08;

  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const Y = (v: number) => PAD_TOP + (1 - (v - mn) / (mx - mn)) * plotH;

  // Column layout: [A] [steps…] [B].
  const cols = steps.length + 2;
  const plotW = W - PAD_LEFT - PAD_RIGHT;
  const colW = plotW / cols;
  const barW = Math.min(colW * 0.6, 64);
  const colX = (i: number) => PAD_LEFT + colW * i + (colW - barW) / 2;

  const bars: React.ReactNode[] = [];

  // Base total bar (A).
  bars.push(
    <rect
      key="base-a"
      x={colX(0)}
      y={Y(totalA)}
      width={barW}
      height={Math.max(0, Y(mn) - Y(totalA))}
      fill="var(--muted-ink)"
      opacity={0.85}
      rx={2}
    />,
  );

  // Step bars.
  steps.forEach((s, i) => {
    const top = cum[i];
    const bottom = cum[i + 1];
    const up = s.delta >= 0;
    const yTop = Y(Math.max(top, bottom));
    const yBot = Y(Math.min(top, bottom));
    bars.push(
      <rect
        key={`step-${i}`}
        x={colX(i + 1)}
        y={yTop}
        width={barW}
        height={Math.max(1, yBot - yTop)}
        fill={up ? 'var(--success-ink)' : 'var(--destructive-ink)'}
        rx={2}
      />,
    );
    // Dashed connector from this step's resulting top to the next column.
    bars.push(
      <line
        key={`conn-${i}`}
        x1={colX(i + 1)}
        y1={Y(bottom)}
        x2={colX(i + 2)}
        y2={Y(bottom)}
        stroke="var(--border-strong)"
        strokeDasharray="3 3"
        strokeWidth={1}
      />,
    );
  });

  // End total bar (B).
  bars.push(
    <rect
      key="base-b"
      x={colX(cols - 1)}
      y={Y(totalB)}
      width={barW}
      height={Math.max(0, Y(mn) - Y(totalB))}
      fill="var(--brand)"
      opacity={0.9}
      rx={2}
    />,
  );

  // Connector from A to the first step.
  bars.unshift(
    <line
      key="conn-a"
      x1={colX(0)}
      y1={Y(totalA)}
      x2={colX(1)}
      y2={Y(totalA)}
      stroke="var(--border-strong)"
      strokeDasharray="3 3"
      strokeWidth={1}
    />,
  );

  const labels = [labelA, ...steps.map((s) => s.label), labelB];
  const valueAtCol = [totalA, ...steps.map((s) => s.delta), totalB];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label="Contribution waterfall"
      style={{ fontFamily: 'var(--font-sans)', display: 'block' }}
    >
      {/* baseline at banded floor */}
      <line x1={PAD_LEFT} y1={Y(mn)} x2={W - PAD_RIGHT} y2={Y(mn)} stroke="var(--border-card)" strokeWidth={1} />
      {bars}
      {labels.map((lab, i) => {
        const isStep = i > 0 && i < cols - 1;
        const v = valueAtCol[i];
        const valStr = isStep ? `${v >= 0 ? '+' : ''}${formatValue(v)}` : formatValue(v);
        return (
          <g key={`lab-${i}`}>
            <text
              x={colX(i) + barW / 2}
              y={H - PAD_BOTTOM + 16}
              textAnchor="middle"
              fontSize={10.5}
              fontWeight={600}
              fill="var(--text-secondary)"
            >
              {valStr}
            </text>
            <text
              x={colX(i) + barW / 2}
              y={H - PAD_BOTTOM + 32}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-muted)"
            >
              {lab.length > 12 ? `${lab.slice(0, 11)}…` : lab}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
