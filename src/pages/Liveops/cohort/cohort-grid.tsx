/**
 * CohortGrid — CSS grid rendering of day-N retention heatmap.
 *
 * Layout:
 *   - Sticky left column: cohort date + size badge.
 *   - 5 day-N columns (D1, D3, D7, D14, D30), each coloured by intensityRamp.
 *   - Not-yet-mature cells → striped pattern with a "?" label, NOT 0%.
 *   - Hover tooltip: shows exact date, size, retained count, and retention %.
 *
 * Accessibility:
 *   - Each cell has aria-label with the human-readable values.
 *   - Stripe pattern uses a CSS repeating-linear-gradient, not color alone.
 */

import React, { useState } from 'react';
import type { CohortRow } from './pivot-cohort-rows';
import { intensityRamp } from './intensity-ramp';

// ── Column definitions ───────────────────────────────────────────────────────

const COLUMNS: Array<{
  label: string;
  pctKey: keyof CohortRow;
  countKey: keyof CohortRow;
  maskIdx: number;
}> = [
  { label: 'D1',  pctKey: 'd1Pct',  countKey: 'd1',  maskIdx: 0 },
  { label: 'D3',  pctKey: 'd3Pct',  countKey: 'd3',  maskIdx: 1 },
  { label: 'D7',  pctKey: 'd7Pct',  countKey: 'd7',  maskIdx: 2 },
  { label: 'D14', pctKey: 'd14Pct', countKey: 'd14', maskIdx: 3 },
  { label: 'D30', pctKey: 'd30Pct', countKey: 'd30', maskIdx: 4 },
];

// ── Stripe pattern for immature cells ────────────────────────────────────────

const STRIPE_BG =
  'repeating-linear-gradient(' +
  '135deg,' +
  '#e5e7eb 0px,' +
  '#e5e7eb 2px,' +
  '#f9fafb 2px,' +
  '#f9fafb 8px)';

// ── Sub-components ───────────────────────────────────────────────────────────

interface TooltipProps {
  label: string;
  visible: boolean;
  x: number;
  y: number;
}

function CellTooltip({ label, visible, x, y }: TooltipProps) {
  if (!visible) return null;
  return (
    <div
      role="tooltip"
      style={{
        position: 'fixed',
        left: x + 12,
        top: y - 8,
        background: 'var(--neutral-900)',
        color: 'var(--text-on-brand)',
        fontSize: 12,
        lineHeight: 1.5,
        padding: '6px 10px',
        borderRadius: 'var(--radius-sm)',
        pointerEvents: 'none',
        zIndex: 9999,
        whiteSpace: 'pre-line',
        maxWidth: 220,
        boxShadow: 'var(--shadow-md)',
      }}
    >
      {label}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export interface CohortGridProps {
  rows: CohortRow[];
}

export function CohortGrid({ rows }: CohortGridProps) {
  const [tooltip, setTooltip] = useState<{ label: string; x: number; y: number } | null>(null);

  // Compute per-column max pct for relative scaling.
  const colMax: Record<string, number> = {};
  for (const col of COLUMNS) {
    const max = rows.reduce((m, r) => {
      const v = r[col.pctKey] as number;
      return r.matureMask[col.maskIdx] && v > m ? v : m;
    }, 0);
    colMax[col.label] = max > 0 ? max : 100;
  }

  const headerCellStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--text-muted)',
    padding: '6px 8px',
    textAlign: 'center',
    background: 'var(--bg-muted)',
    borderBottom: '1px solid var(--border-card)',
  };

  return (
    // data-visual-volatile: cells are live retention data + a value-driven
    // heatmap (not theme tokens), so the visual-regression gate masks this grid.
    <div data-visual-volatile style={{ overflowX: 'auto', position: 'relative' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '160px repeat(5, 1fr)',
          minWidth: 560,
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          border: '1px solid var(--border-card)',
        }}
      >
        {/* Header row */}
        <div style={{ ...headerCellStyle, textAlign: 'left', position: 'sticky', left: 0, zIndex: 2 }}>
          Cohort date
        </div>
        {COLUMNS.map((col) => (
          <div key={col.label} style={headerCellStyle}>
            {col.label}
          </div>
        ))}

        {/* Data rows */}
        {rows.map((row, rowIdx) => {
          const isEven = rowIdx % 2 === 0;
          const rowBg = isEven ? 'var(--bg-card)' : 'var(--bg-muted)';

          return (
            <React.Fragment key={row.installDate}>
              {/* Left sticky column */}
              <div
                style={{
                  position: 'sticky',
                  left: 0,
                  zIndex: 1,
                  background: rowBg,
                  padding: '6px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  borderBottom: '1px solid var(--border-card)',
                  borderRight: '1px solid var(--border-card)',
                }}
              >
                {/* Phase 4.3 — link cohort row → funnel builder seeded with
                    onboarding template. Full cohort-uid join is server-side
                    work the cached grid doesn't materialize today; this is
                    the most useful step we can ship without that pipeline. */}
                <a
                  href={`#/segments/new/funnel?cohort=${row.installDate}`}
                  style={{
                    fontSize: 12, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums',
                    textDecoration: 'none', borderBottom: '1px dotted var(--text-muted)',
                  }}
                  title="Open onboarding funnel for this install date"
                >
                  {row.installDate}
                </a>
                <span style={{
                  fontSize: 10,
                  background: 'var(--bg-muted)',
                  border: '1px solid var(--border-card)',
                  borderRadius: 'var(--radius-full)',
                  padding: '1px 6px',
                  color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                }}>
                  n={row.size.toLocaleString()}
                </span>
              </div>

              {/* Day-N cells */}
              {COLUMNS.map((col) => {
                const pct     = row[col.pctKey] as number;
                const count   = row[col.countKey] as number;
                const mature  = row.matureMask[col.maskIdx];

                const cellAriaLabel = mature
                  ? `${row.installDate} ${col.label}: ${pct}% (${count} of ${row.size})`
                  : `${row.installDate} ${col.label}: not yet mature`;

                const { bg, text } = mature
                  ? intensityRamp(pct, colMax[col.label])
                  : { bg: 'transparent', text: 'var(--text-muted)' };

                const handleMouseEnter = (e: React.MouseEvent) => {
                  const label = mature
                    ? `${row.installDate}\nCohort size: ${row.size.toLocaleString()}\n${col.label} retained: ${count.toLocaleString()} (${pct}%)`
                    : `${row.installDate}\n${col.label}: not yet mature\n(cohort is less than ${[1,3,7,14,30][col.maskIdx]}d old)`;
                  setTooltip({ label, x: e.clientX, y: e.clientY });
                };

                return (
                  <div
                    key={col.label}
                    aria-label={cellAriaLabel}
                    role="cell"
                    onMouseEnter={handleMouseEnter}
                    onMouseMove={(e) =>
                      setTooltip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : null)
                    }
                    onMouseLeave={() => setTooltip(null)}
                    style={{
                      background: mature ? bg : STRIPE_BG,
                      borderBottom: '1px solid var(--border-card)',
                      padding: '6px 4px',
                      textAlign: 'center',
                      fontSize: 12,
                      fontWeight: 500,
                      color: mature ? text : 'var(--text-muted)',
                      fontVariantNumeric: 'tabular-nums',
                      cursor: 'default',
                      userSelect: 'none',
                      transition: 'opacity 0.1s',
                    }}
                  >
                    {mature ? `${pct}%` : '—'}
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>

      {/* Portal-style tooltip rendered at cursor position */}
      {tooltip && (
        <CellTooltip
          label={tooltip.label}
          visible
          x={tooltip.x}
          y={tooltip.y}
        />
      )}
    </div>
  );
}
