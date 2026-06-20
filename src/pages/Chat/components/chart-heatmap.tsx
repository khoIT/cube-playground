/**
 * ChartHeatmap — CSS-grid heatmap renderer for the 'heatmap' ChartSpec type.
 *
 * Recharts has no heatmap primitive, so this is a hand-rolled grid (same
 * approach as the LiveOps cohort grid): `encoding.category` values become
 * columns (x), `encoding.series` values become rows (y), and each cell's
 * background intensity encodes `encoding.value` relative to the grid max.
 *
 * Categorical axes keep their submitted order (the LLM/query owns it), but
 * recognisably time-like axes (weekdays, months, hours, numbers) are re-sorted
 * into natural time order — "top N cells by value" queries arrive value-sorted,
 * which would otherwise scramble them (e.g. Sun before Fri).
 */
import React, { useState } from 'react';
import { T } from '../../../shell/theme';
import type { ChartSpec } from '../../../api/chat-sse-client';
import { labelOf, type LabelMap } from './chart-column-labels';
import { canonicalAxisOrder, padTimeAxis } from './chart-heatmap-axis-order';
import { HeatmapDrilldownPopover } from './heatmap-drilldown-popover';
import { heatmapCellToPredicate, cubeOfMember } from './heatmap-cell-to-predicate';

interface SelectedCell {
  y: string | number;
  x: string | number;
  v: number;
  rect: DOMRect;
}

interface ChartHeatmapProps {
  spec: ChartSpec;
  labels: LabelMap;
  /** Formats a cell value for display (unit-aware, from format-chart-value). */
  formatValue: (v: number | string) => string;
}

/**
 * Sequential warm ramp, amber → orange → red (light → deep). Mirrors the
 * stop-interpolation approach of src/pages/Liveops/cohort/intensity-ramp.ts;
 * the hue shift across stops keeps mid-range cells distinguishable where a
 * single-hue orange ramp blurs together. Text flips to white past the
 * midpoint for contrast.
 */
const STOPS: Array<[bg: string, text: string]> = [
  ['#fef3c7', '#78350f'], //   0 — light amber, dark text
  ['#fcd34d', '#78350f'], //  25 — amber
  ['#fb923c', '#431407'], //  50 — orange
  ['#dc2626', '#ffffff'], //  75 — red
  ['#7f1d1d', '#ffffff'], // 100 — deep red, white text
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

/**
 * bg + text colors for a value scaled into [0, 1] against the [min, max]
 * range of present cells. Min–max (not zero-based) scaling: "top N cells"
 * grids cluster in a narrow high band (e.g. 125K–217K), and a zero-based
 * scale would paint them all the same shade. All-equal grids sit mid-ramp.
 */
export function heatColor(value: number, min: number, max: number): { bg: string; text: string } {
  const range = max - min;
  const scaled = range > 0 ? Math.max(0, Math.min((value - min) / range, 1)) : max > 0 ? 0.5 : 0;
  // Clamp the segment INDEX (not the position) so scaled=1 lands on the
  // deepest stop with t=1 instead of snapping back to the 75% stop.
  const pos = scaled * (STOPS.length - 1);
  const segIdx = Math.min(Math.floor(pos), STOPS.length - 2);
  const t = pos - segIdx;
  const [bgA, textA] = STOPS[segIdx];
  const [bgB, textB] = STOPS[segIdx + 1];
  return {
    bg: t < 0.001 ? bgA : t > 0.999 ? bgB : interpolateColor(bgA, bgB, t),
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

  // Time-like axes get canonical order AND full-range padding (00h..23h,
  // Mon..Sun) so gaps show as empty slots instead of vanishing columns.
  const xs = padTimeAxis(canonicalAxisOrder(uniqueInOrder(spec.data, category)));
  const ys = padTimeAxis(canonicalAxisOrder(uniqueInOrder(spec.data, series)));

  // (y, x) → value lookup; later duplicates win, matching last-write semantics.
  const cells = new Map<string, number>();
  let min = Infinity;
  let max = -Infinity;
  let total = 0;
  for (const row of spec.data) {
    const v = Number(row[value]) || 0;
    total += v;
    cells.set(`${String(row[series])}\u0000${String(row[category])}`, v);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) min = max = 0; // empty-data guard

  const [selected, setSelected] = useState<SelectedCell | null>(null);

  // Cell values stay visible up to ~30 columns — wide grids get a real
  // per-column min width and the container scrolls horizontally instead of
  // squeezing cells until text is unreadable. Beyond that, tooltip only.
  const showCellText = xs.length <= 30;
  const cellFont = xs.length <= 8 ? 11 : 10;
  const colMinWidth = showCellText ? 54 : 28;

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <div
        role="table"
        aria-label={spec.title}
        style={{
          display: 'grid',
          gridTemplateColumns: `minmax(72px, max-content) repeat(${xs.length}, minmax(${colMinWidth}px, 1fr))`,
          gap: 2,
          fontFamily: T.fSans,
          minWidth: xs.length * (colMinWidth + 2) + 80,
        }}
      >
        {/* Header row: corner spacer + x labels */}
        <div />
        {xs.map((x) => (
          <div
            key={String(x)}
            style={{
              fontSize: 10,
              color: 'var(--shell-text-subtle)',
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
                color: 'var(--shell-text-muted)',
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
                // Tooltip disambiguates "not in the result" from a true zero
                // (e.g. hours that didn't make a "top N cells" cut).
                return (
                  <div
                    key={String(x)}
                    title={`${String(y)} × ${String(x)}: no data in this result`}
                    style={{ background: 'var(--shell-bg-subtle)', borderRadius: 3, minHeight: 24 }}
                  />
                );
              }
              const { bg, text } = heatColor(v, min, max);
              const isSelected =
                selected != null && String(selected.y) === String(y) && String(selected.x) === String(x);
              return (
                <div
                  key={String(x)}
                  role="cell"
                  tabIndex={0}
                  aria-label={`${String(y)} × ${String(x)}: ${formatValue(v)} — open details`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected({ y, x, v, rect: e.currentTarget.getBoundingClientRect() });
                    }
                  }}
                  title={`${labelOf(labels, series)}: ${String(y)}\n${labelOf(labels, category)}: ${String(x)}\n${labelOf(labels, value)}: ${formatValue(v)}`}
                  onClick={(e) =>
                    setSelected({ y, x, v, rect: e.currentTarget.getBoundingClientRect() })
                  }
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
                    cursor: 'pointer',
                    userSelect: 'none',
                    overflow: 'hidden',
                    outline: isSelected ? '2px solid var(--brand)' : 'none',
                    outlineOffset: isSelected ? -1 : 0,
                  }}
                >
                  {showCellText ? formatValue(v) : null}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {selected && (
        <HeatmapDrilldownPopover
          rect={selected.rect}
          seriesLabel={labelOf(labels, series)}
          seriesValue={String(selected.y)}
          categoryLabel={labelOf(labels, category)}
          categoryValue={String(selected.x)}
          valueLabel={labelOf(labels, value)}
          valueFormatted={formatValue(selected.v)}
          pctOfTotal={total > 0 ? selected.v / total : 0}
          cube={cubeOfMember(series)}
          predicate={heatmapCellToPredicate({
            seriesDim: series,
            seriesValue: selected.y,
            categoryDim: category,
            categoryValue: selected.x,
          })}
          segmentName={`${String(selected.y)} × ${String(selected.x)}`}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
