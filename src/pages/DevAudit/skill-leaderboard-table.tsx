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
import { SkillTrendSparkline } from './skill-trend-sparkline';

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
    background: 'var(--surface-subtle)',
    borderBottom: `1px solid var(--shell-border)`,
    color: 'var(--shell-text-muted)',
    cursor: 'pointer',
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
    fontFamily: T.fMono,
    fontSize: 10.5,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    fontWeight: 500,
  },
  /** Non-sortable header (e.g. Trend column) */
  thStatic: {
    padding: '6px 12px',
    textAlign: 'left' as const,
    background: 'var(--surface-subtle)',
    borderBottom: `1px solid var(--shell-border)`,
    color: 'var(--shell-text-muted)',
    whiteSpace: 'nowrap' as const,
    fontFamily: T.fMono,
    fontSize: 10.5,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    fontWeight: 500,
  },
  /** Active sort column header — brand accent */
  thActive: {
    color: 'var(--shell-brand)',
  },
  td: {
    padding: '6px 12px',
    borderBottom: `1px solid var(--shell-bg-subtle)`,
    color: 'var(--shell-text-secondary)',
    fontFamily: T.fMono,
    fontSize: 11,
    textAlign: 'right' as const,
    whiteSpace: 'nowrap' as const,
  },
  tdSkill: {
    padding: '6px 12px',
    borderBottom: `1px solid var(--shell-bg-subtle)`,
    color: 'var(--shell-text-emphasis)',
    fontFamily: T.fSans,
    fontWeight: 500,
    fontSize: 12.5,
    textAlign: 'left' as const,
  },
  tdTrend: {
    padding: '4px 12px',
    borderBottom: `1px solid var(--shell-bg-subtle)`,
    textAlign: 'left' as const,
  },
  empty: {
    padding: 24,
    textAlign: 'center' as const,
    color: 'var(--shell-text-subtle)',
    fontFamily: T.fSans,
    fontSize: 13,
  },
};

interface Props {
  rows: SkillRow[];
  /** Optional: called when user clicks a skill name cell. Navigates to Sessions tab filtered by skill. */
  onSkillClick?: (skill: string) => void;
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

export function SkillLeaderboardTable({ rows, onSkillClick }: Props) {
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
    const isActive = sortKey === key;
    return (
      <th
        style={isActive ? { ...S.th, ...S.thActive } : S.th}
        onClick={() => handleHeaderClick(key)}
        data-testid={`th-${key}`}
        aria-sort={isActive ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
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
            <th style={S.thStatic} data-testid="th-trend">Trend</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.skill} data-testid={`row-${row.skill}`}>
              <td style={S.tdSkill}>
                {onSkillClick ? (
                  <button
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      color: 'var(--shell-brand)',
                      fontFamily: T.fSans,
                      fontWeight: 500,
                      fontSize: 12.5,
                      textDecoration: 'underline',
                    }}
                    onClick={() => onSkillClick(row.skill)}
                    title={`Filter sessions by skill: ${row.skill}`}
                  >
                    {row.skill}
                  </button>
                ) : row.skill}
              </td>
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
                    style={{ marginLeft: 4, color: 'var(--shell-text-faint)', fontSize: 10 }}
                  >
                    ({row.legacyCount} legacy)
                  </span>
                )}
              </td>
              <td style={S.tdTrend} data-testid={`trend-${row.skill}`}>
                <SkillTrendSparkline data={row.dailyCounts} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
