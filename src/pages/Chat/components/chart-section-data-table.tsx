/**
 * ChartSectionDataTable — alternate view of a ChartArtifact as a plain table.
 *
 * Headers derive from the keys present in the first data row. Numeric cells
 * are right-aligned; everything else stays left-aligned. Long content scrolls
 * horizontally inside the table wrapper.
 */
import React from 'react';
import { T } from '../../../shell/theme';

interface ChartSectionDataTableProps {
  rows: Array<Record<string, string | number>>;
}

export function ChartSectionDataTable({ rows }: ChartSectionDataTableProps) {
  if (rows.length === 0) {
    return (
      <div
        style={{
          fontFamily: T.fSans,
          fontSize: 13,
          color: T.n500,
          padding: '12px 0',
        }}
      >
        No data.
      </div>
    );
  }

  const columns = Object.keys(rows[0]);

  return (
    <div style={{ overflowX: 'auto', width: '100%' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: T.fSans,
          fontSize: 13,
          color: T.n900,
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
                  borderBottom: `1px solid ${T.n200}`,
                  fontWeight: 600,
                  color: T.n600,
                  whiteSpace: 'nowrap',
                }}
              >
                {c}
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
                      borderBottom: `1px solid ${T.n100}`,
                      textAlign: isNumeric ? 'right' : 'left',
                      whiteSpace: 'nowrap',
                      fontVariantNumeric: isNumeric ? 'tabular-nums' : undefined,
                    }}
                  >
                    {String(v)}
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
