/**
 * SkillLeaderboardTable — sortable table of per-skill aggregates.
 *
 * Columns: Skill, Count, p50ms, p95ms, Avg $, Total $, Success %.
 * Default sort: p95 latency desc (matches API default).
 * Click a header to toggle asc/desc on that column.
 */

import React, { useState, useMemo } from 'react';
import { T } from '../../shell/theme';
import type { SkillRow } from './use-skill-leaderboard';

type SortKey = keyof Pick<
  SkillRow,
  'skill' | 'count' | 'p50LatencyMs' | 'p95LatencyMs' | 'avgCostUsd' | 'totalCostUsd' | 'successRate'
>;

const S = {
  wrap: { overflowX: 'auto' as const },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 12,
    fontFamily: T.fSans,
  },
  th: {
    padding: '6px 12px',
    textAlign: 'left' as const,
    background: T.surfaceSubtle,
    borderBottom: `1px solid ${T.n200}`,
    color: T.n600,
    cursor: 'pointer',
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
  },
  td: {
    padding: '5px 12px',
    borderBottom: `1px solid ${T.n100}`,
    color: T.n800,
    fontFamily: T.fMono,
    fontSize: 11,
  },
  tdSkill: {
    padding: '5px 12px',
    borderBottom: `1px solid ${T.n100}`,
    color: T.n800,
    fontFamily: T.fSans,
    fontWeight: 500,
    fontSize: 12,
  },
  empty: {
    padding: 24,
    textAlign: 'center' as const,
    color: T.n500,
    fontFamily: T.fSans,
    fontSize: 13,
  },
};

interface Props {
  rows: SkillRow[];
}

function fmtMs(v: number | null): string {
  if (v === null) return '—';
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
}

function fmtUsd(v: number | null): string {
  if (v === null) return '—';
  return `$${v.toFixed(4)}`;
}

function fmtPct(v: number | null): string {
  if (v === null) return '—';
  return `${(v * 100).toFixed(0)}%`;
}

function sortIndicator(key: SortKey, active: SortKey, dir: 'asc' | 'desc') {
  if (key !== active) return ' ↕';
  return dir === 'desc' ? ' ↓' : ' ↑';
}

type Comparator = (a: SkillRow, b: SkillRow) => number;

function makeComparator(key: SortKey, dir: 'asc' | 'desc'): Comparator {
  const sign = dir === 'desc' ? -1 : 1;
  return (a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;   // nulls last regardless of direction
    if (bv === null) return -1;
    if (typeof av === 'string' && typeof bv === 'string') {
      return sign * av.localeCompare(bv);
    }
    return sign * ((av as number) - (bv as number));
  };
}

export function SkillLeaderboardTable({ rows }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('p95LatencyMs');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function handleHeaderClick(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sorted = useMemo(
    () => [...rows].sort(makeComparator(sortKey, sortDir)),
    [rows, sortKey, sortDir],
  );

  function th(label: string, key: SortKey) {
    return (
      <th
        style={S.th}
        onClick={() => handleHeaderClick(key)}
        data-testid={`th-${key}`}
        aria-sort={sortKey === key ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
      >
        {label}{sortIndicator(key, sortKey, sortDir)}
      </th>
    );
  }

  if (rows.length === 0) {
    return <div style={S.empty} data-testid="leaderboard-empty">No skill data in this window.</div>;
  }

  return (
    <div style={S.wrap}>
      <table style={S.table} data-testid="leaderboard-table">
        <thead>
          <tr>
            {th('Skill', 'skill')}
            {th('Count', 'count')}
            {th('p50', 'p50LatencyMs')}
            {th('p95', 'p95LatencyMs')}
            {th('Avg $', 'avgCostUsd')}
            {th('Total $', 'totalCostUsd')}
            {th('Success %', 'successRate')}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.skill} data-testid={`row-${row.skill}`}>
              <td style={S.tdSkill}>{row.skill}</td>
              <td style={S.td}>{row.count}</td>
              <td style={S.td}>{fmtMs(row.p50LatencyMs)}</td>
              <td style={S.td}>{fmtMs(row.p95LatencyMs)}</td>
              <td style={S.td}>{fmtUsd(row.avgCostUsd)}</td>
              <td style={S.td}>{fmtUsd(row.totalCostUsd)}</td>
              <td style={S.td}>
                {fmtPct(row.successRate)}
                {row.legacyCount > 0 && (
                  <span
                    title={`${row.legacyCount} turn(s) predate stop_reason tracking`}
                    style={{ marginLeft: 4, color: T.n400, fontSize: 10 }}
                  >
                    ({row.legacyCount} legacy)
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
