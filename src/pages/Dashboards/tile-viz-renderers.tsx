/**
 * Visualization sub-renderers for dashboard tiles.
 * Each function receives a Cube ResultSet and returns the matching viz element.
 * Extracted from tile.tsx to keep that file under 200 LOC.
 */

import React from 'react';
import type { ResultSet } from '@cubejs-client/core';
import { KpiTile } from '../Segments/visuals/kpi-tile';
import { LineChart } from '../Segments/visuals/line-chart';
import { BarList } from '../Segments/visuals/bar-list';

export function extractKpiValue(rs: ResultSet): string {
  try {
    const data = rs.rawData();
    if (!data.length) return '–';
    const latest = data[data.length - 1];
    // Cube returns time dimensions and measures together; prefer the measure
    // (numeric or numeric-string) over the time dim (ISO date string).
    const key = Object.keys(latest).find((k) => {
      const v = latest[k];
      if (typeof v === 'number') return true;
      if (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) return true;
      return false;
    });
    if (!key) return '–';
    const v = latest[key];
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n.toLocaleString() : String(v ?? '–');
  } catch {
    return '–';
  }
}

export function extractLineData(rs: ResultSet) {
  try {
    const data = rs.rawData();
    if (!data.length) return [];
    const keys = Object.keys(data[0]);
    const xKey = keys.find((k) => {
      const v = data[0][k];
      return typeof v === 'string' && isNaN(Number(v)) && !k.endsWith('.count') && !k.endsWith('sum');
    }) ?? keys[0];
    const yKey = keys.find((k) => k !== xKey) ?? keys[0];
    return data.map((row) => ({
      x: String(row[xKey] ?? ''),
      y: parseFloat(String(row[yKey] ?? '0')) || 0,
    }));
  } catch {
    return [];
  }
}

export function extractBarData(rs: ResultSet) {
  try {
    const data = rs.rawData();
    if (!data.length) return [];
    const keys = Object.keys(data[0]);
    const labelKey = keys[0];
    const valueKey = keys[1] ?? keys[0];
    return data.slice(0, 10).map((row) => ({
      label: String(row[labelKey] ?? ''),
      value: parseFloat(String(row[valueKey] ?? '0')) || 0,
    }));
  } catch {
    return [];
  }
}

export function extractTableData(
  rs: ResultSet,
): { columns: string[]; rows: Record<string, unknown>[] } {
  try {
    const rows = rs.rawData() as Record<string, unknown>[];
    const columns = rows.length ? Object.keys(rows[0]) : [];
    return { columns, rows: rows.slice(0, 50) };
  } catch {
    return { columns: [], rows: [] };
  }
}

interface TileBodyProps {
  vizType: string;
  title: string;
  resultSet: ResultSet;
}

const cellStyle: React.CSSProperties = {
  padding: '2px 6px',
  borderBottom: '1px solid var(--border-card)',
};

export function TileVizBody({ vizType, title, resultSet }: TileBodyProps) {
  switch (vizType) {
    case 'kpi':
      return <KpiTile label={title} value={extractKpiValue(resultSet)} />;
    case 'line':
      return <LineChart data={extractLineData(resultSet)} height={100} />;
    case 'bar':
      return <BarList items={extractBarData(resultSet)} />;
    case 'table': {
      const { columns, rows } = extractTableData(resultSet);
      return (
        <div style={{ overflowX: 'auto', fontSize: 11 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c} style={{ ...cellStyle, textAlign: 'left' }}>
                    {c.split('.').pop()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c} style={cellStyle}>{String(row[c] ?? '–')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    default:
      return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Unknown viz type</div>;
  }
}
