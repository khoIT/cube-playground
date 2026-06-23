/**
 * ChartSectionDataTable — alternate view of a ChartArtifact as a plain table.
 *
 * Headers derive from the keys present in the first data row. Numeric cells
 * are right-aligned; everything else stays left-aligned. Long content scrolls
 * horizontally inside the table wrapper; tall result sets scroll vertically
 * inside a capped viewport (mirrors the chart's fixed height) with a pinned
 * header, so a 30-row table doesn't blow out the message card.
 */
import React, { useMemo } from 'react';
import { T } from '../../../shell/theme';
import type { ChartSpec } from '../../../api/chat-sse-client';
import {
  detectColumnUnit,
  detectPercentScale,
  formatReadableValue,
  type ValueUnit,
} from './format-chart-value';
import { labelOf, type LabelMap } from './chart-column-labels';

/**
 * Vertical cap for the scroll viewport, matching the chart view's fixed height
 * so chart↔table toggling doesn't change the card's footprint. Beyond this the
 * body scrolls and the header stays pinned.
 */
const TABLE_MAX_HEIGHT = 320;

interface ChartSectionDataTableProps {
  rows: Array<Record<string, string | number>>;
  /**
   * Source chart spec (title + caption + encoding). When supplied, lets us
   * pick a per-column unit so a "revenue" column reads as "315M VND" instead
   * of "314982000". Optional — table still renders without it (just falls
   * back to thousand-separated numbers).
   */
  spec?: ChartSpec;
  /**
   * Member-ref → display label map (from the artifact's `columns`). Renders
   * "Total LTV (VND)" headers instead of raw "mf_users.ltv_total_vnd" keys.
   * Optional — falls back to a humanised key.
   */
  labels?: LabelMap;
}

export function ChartSectionDataTable({ rows, spec, labels = {} }: ChartSectionDataTableProps) {
  if (rows.length === 0) {
    return (
      <div
        style={{
          fontFamily: T.fSans,
          fontSize: 13,
          color: 'var(--shell-text-subtle)',
          padding: '12px 0',
        }}
      >
        No data.
      </div>
    );
  }

  const columns = Object.keys(rows[0]);
  // Per-column unit detection memoised on the spec to avoid re-scanning the
  // title/caption strings on every render.
  const unitByColumn = useMemo<Record<string, ValueUnit>>(() => {
    const map: Record<string, ValueUnit> = {};
    for (const c of columns) map[c] = detectColumnUnit(c, spec);
    return map;
  }, [columns, spec]);
  // Percent columns may be fractions (0.0069) or already-scaled (42.5); pick the
  // factor per column from its values so the table matches the chart axis.
  const percentScaleByColumn = useMemo<Record<string, 100 | 1>>(() => {
    const map: Record<string, 100 | 1> = {};
    for (const c of columns) {
      map[c] = unitByColumn[c] === 'percent' ? detectPercentScale(rows.map((r) => r[c])) : 1;
    }
    return map;
  }, [columns, rows, unitByColumn]);

  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: TABLE_MAX_HEIGHT, width: '100%' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: T.fSans,
          fontSize: 13,
          color: 'var(--shell-text)',
        }}
      >
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                style={{
                  textAlign: 'left',
                  padding: '8px 12px',
                  borderBottom: `1px solid var(--shell-border)`,
                  fontWeight: 600,
                  color: 'var(--shell-text-muted)',
                  whiteSpace: 'nowrap',
                  position: 'sticky',
                  top: 0,
                  background: 'var(--surface-raised)',
                  zIndex: 1,
                }}
              >
                {labelOf(labels, c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const v = row[c];
                const isNumeric = typeof v === 'number';
                return (
                  <td
                    key={c}
                    style={{
                      padding: '8px 12px',
                      borderBottom: `1px solid var(--shell-bg-subtle)`,
                      textAlign: isNumeric ? 'right' : 'left',
                      whiteSpace: 'nowrap',
                      fontVariantNumeric: isNumeric ? 'tabular-nums' : undefined,
                    }}
                  >
                    {isNumeric ? formatReadableValue(v, unitByColumn[c], percentScaleByColumn[c]) : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
