/**
 * ChartHeatmap — CSS-grid heatmap renderer for the 'heatmap' ChartSpec type.
 *
 * Recharts has no heatmap primitive, so this is a hand-rolled grid (same
 * approach as the LiveOps cohort grid): `encoding.category` values become
 * columns (x), `encoding.series` values become rows (y), and each cell's
 * background intensity encodes `encoding.value` relative to the grid max.
 *
 * Cells keep their submitted order on both axes — the LLM/query owns ordering
 * (e.g. Mon..Sun, 0..23), re-sorting here would scramble time-like axes.
 */
import React from 'react';
import { T } from '../../../shell/theme';
import type { ChartSpec } from '../../../api/chat-sse-client';
import { labelOf, type LabelMap } from './chart-column-labels';

interface ChartHeatmapProps {
  spec: ChartSpec;
  labels: LabelMap;
  /** Formats a cell value for display (unit-aware, from format-chart-value). */
  formatValue: (v: number | string) => string;
}

/**
 * Sequential brand-orange ramp (light → deep). Mirrors the stop-interpolation
 * approach of src/pages/Liveops/cohort/intensity-ramp.ts but on the chat
 * surface's brand hue; text flips to white past the midpoint for contrast.
 */
const STOPS: Array<[bg: string, text: string]> = [
  ['#fff7ed', '#7c2d12'], //   0 — near-white orange tint, dark text
  ['#fed7aa', '#7c2d12'], //  25
  ['#fb923c', '#431407'], //  50
  ['#ea580c', '#ffffff'], //  75
  ['#7c2d12', '#ffffff'], // 100 — deep orange, white text
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function interpolateColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const c = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

/** bg + text colors for a value scaled into [0, 1] against the grid max. */
export function heatColor(value: number, max: number): { bg: string; text: string } {
  const scaled = max > 0 ? Math.max(0, Math.min(value / max, 1)) : 0;
  const segment = Math.min(scaled * (STOPS.length - 1), STOPS.length - 2);
  const segIdx = Math.floor(segment);
  const t = segment - segIdx;
  const [bgA, textA] = STOPS[segIdx];
  const [bgB, textB] = STOPS[segIdx + 1];
  return {
    bg: t < 0.001 ? bgA : interpolateColor(bgA, bgB, t),
    text: scaled >= 0.6 ? textB : textA,
  };
}

/** Unique values of a column in first-seen (submitted) order. */
function uniqueInOrder(
  rows: Array<Record<string, string | number>>,
  col: string,
): Array<string | number> {
  const seen = new Set<string>();
  const out: Array<string | number> = [];
  for (const row of rows) {
    const key = String(row[col]);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(row[col]);
    }
  }
  return out;
}

export function ChartHeatmap({ spec, labels, formatValue }: ChartHeatmapProps) {
  const { category, value } = spec.encoding;
  // Zod requires series on heatmap, but a bad payload shouldn't NPE the renderer.
  const series = spec.encoding.series ?? category;

  const xs = uniqueInOrder(spec.data, category);
  const ys = uniqueInOrder(spec.data, series);

  // (y, x) → value lookup; later duplicates win, matching last-write semantics.
  const cells = new Map<string, number>();
  let max = 0;
  for (const row of spec.data) {
    const v = Number(row[value]) || 0;
    cells.set(`${String(row[series])}\u0000${String(row[category])}`, v);
    if (v > max) max = v;
  }

  // Compact text fits only on small grids; bigger grids rely on the tooltip.
  const showCellText = xs.length <= 14;
  const cellFont = xs.length <= 8 ? 11 : 10;

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <div
        role="table"
        aria-label={spec.title}
        style={{
          display: 'grid',
          gridTemplateColumns: `minmax(72px, max-content) repeat(${xs.length}, minmax(28px, 1fr))`,
          gap: 2,
          fontFamily: T.fSans,
          minWidth: xs.length * 30 + 80,
        }}
      >
        {/* Header row: corner spacer + x labels */}
        <div />
        {xs.map((x) => (
          <div
            key={String(x)}
            style={{
              fontSize: 10,
              color: T.n500,
              textAlign: 'center',
              padding: '2px 1px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={String(x)}
          >
            {String(x)}
          </div>
        ))}

        {/* One row per y value: label + cells */}
        {ys.map((y) => (
          <React.Fragment key={String(y)}>
            <div
              style={{
                fontSize: 11,
                color: T.n600,
                padding: '0 8px 0 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                whiteSpace: 'nowrap',
              }}
              title={String(y)}
            >
              {String(y)}
            </div>
            {xs.map((x) => {
              const v = cells.get(`${String(y)}\u0000${String(x)}`);
              if (v === undefined) {
                // Missing (y, x) pair — render an empty slot, not a zero cell.
                return (
                  <div
                    key={String(x)}
                    style={{ background: T.n100, borderRadius: 3, minHeight: 24 }}
                  />
                );
              }
              const { bg, text } = heatColor(v, max);
              return (
                <div
                  key={String(x)}
                  role="cell"
                  title={`${labelOf(labels, series)}: ${String(y)}\n${labelOf(labels, category)}: ${String(x)}\n${labelOf(labels, value)}: ${formatValue(v)}`}
                  style={{
                    background: bg,
                    color: text,
                    borderRadius: 3,
                    minHeight: 24,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: cellFont,
                    fontVariantNumeric: 'tabular-nums',
                    cursor: 'default',
                    userSelect: 'none',
                    overflow: 'hidden',
                  }}
                >
                  {showCellText ? formatValue(v) : null}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
