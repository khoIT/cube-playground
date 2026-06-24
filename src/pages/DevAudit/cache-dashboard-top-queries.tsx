/**
 * CacheDashboardTopQueries — sortable table of the most-hit cached queries.
 *
 * Columns: Query snippet, Skill, Model, Hits, Last hit, $ saved.
 * Default sort: hits desc. Client-side only — backend already orders by hit_count.
 * Click row → navigates to original turn anchor (if session/turn ids present).
 * Truncates query snippet at 80 chars.
 */

import React, { useState, useMemo } from 'react';
import { useHistory } from 'react-router-dom';
import { T } from '../../shell/theme';
import type { TopQueryRow } from '../../api/cache-effectiveness-types';
import { useAuditBasePath, auditPath } from './audit-base-path';

interface Props {
  rows: TopQueryRow[];
  topN: number;
}

type SortCol = 'hits' | 'dollarsSaved';
type SortDir = 'asc' | 'desc';

// ── helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string, max = 80): string {
  if (!s) return '—';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// BE emits ms-epoch numbers; accept ISO strings too in case a fixture/older payload feeds them.
function fmtRelative(at: number | string | null): string {
  if (at == null) return '—';
  const ts = typeof at === 'number' ? at : new Date(at).getTime();
  if (!Number.isFinite(ts)) return '—';
  const ms = Date.now() - ts;
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function fmtDollars(n: number): string {
  return `$${n.toFixed(2)}`;
}

// ── styles ────────────────────────────────────────────────────────────────────

const S = {
  sectionTitle: {
    fontSize: 13,
    color: 'var(--shell-text)',
    fontWeight: 600,
    margin: '16px 0 8px',
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
  } as React.CSSProperties,
  sectionSub: {
    fontSize: 11,
    color: 'var(--shell-text-subtle)',
    fontWeight: 400,
    fontFamily: T.fMono,
  } as React.CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    background: 'var(--surface-raised)',
    border: `1px solid var(--shell-border)`,
    borderRadius: 8,
    overflow: 'hidden',
  } as React.CSSProperties,
  th: {
    textAlign: 'left' as const,
    fontSize: 10.5,
    color: 'var(--shell-text-subtle)',
    fontWeight: 500,
    padding: '8px 12px',
    borderBottom: `1px solid var(--shell-border)`,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    fontFamily: T.fMono,
    background: 'var(--surface-subtle)',
    cursor: 'default',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  thSortable: {
    cursor: 'pointer',
    userSelect: 'none' as const,
  } as React.CSSProperties,
  thR: { textAlign: 'right' as const } as React.CSSProperties,
  td: {
    padding: '8px 12px',
    borderBottom: `1px solid var(--shell-bg-subtle)`,
    fontSize: 12,
    color: 'var(--shell-text-emphasis)',
    verticalAlign: 'top',
  } as React.CSSProperties,
  tdMono: {
    fontFamily: T.fMono,
    whiteSpace: 'nowrap' as const,
    color: 'var(--shell-text-secondary)',
  } as React.CSSProperties,
  tdBrand: { color: 'var(--shell-brand)' } as React.CSSProperties,
  tdR: { textAlign: 'right' as const } as React.CSSProperties,
  snippet: { color: 'var(--shell-text-emphasis)' } as React.CSSProperties,
  snippetMeta: {
    fontFamily: T.fMono,
    fontSize: 10.5,
    color: 'var(--shell-text-subtle)',
    marginTop: 2,
  } as React.CSSProperties,
  emptyCell: {
    padding: 32,
    textAlign: 'center' as const,
    color: 'var(--shell-text-subtle)',
    fontFamily: T.fMono,
    fontSize: 12,
  } as React.CSSProperties,
  emptyHint: {
    display: 'block',
    marginTop: 4,
    fontSize: 11,
    color: 'var(--shell-text-faint)',
  } as React.CSSProperties,
};

// ── component ─────────────────────────────────────────────────────────────────

export function CacheDashboardTopQueries({ rows, topN }: Props) {
  const history = useHistory();
  const basePath = useAuditBasePath();
  const [sortCol, setSortCol] = useState<SortCol>('hits');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function toggleSort(col: SortCol) {
    if (col === sortCol) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  }

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aVal = sortCol === 'hits' ? a.hitCount : a.dollarsSaved;
      const bVal = sortCol === 'hits' ? b.hitCount : b.dollarsSaved;
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
    });
  }, [rows, sortCol, sortDir]);

  function handleRowClick(row: TopQueryRow) {
    if (!row.originalSessionId) return;
    const anchor = row.originalTurnId ? `#turn-${row.originalTurnId}` : '';
    history.push(`${auditPath(basePath, 'sessions', row.originalSessionId)}${anchor}`);
  }

  function sortIndicator(col: SortCol): string {
    if (col !== sortCol) return '';
    return sortDir === 'desc' ? ' ↓' : ' ↑';
  }

  const thStyle = (col: SortCol) => ({
    ...S.th,
    ...S.thSortable,
    ...(col === sortCol ? { color: 'var(--shell-text-emphasis)' } : {}),
  });

  return (
    <>
      <div style={S.sectionTitle}>
        Top cached queries
        <span style={S.sectionSub}>ordered by hit count · top {topN}</span>
      </div>

      <table style={S.table} data-testid="top-queries-table">
        <thead>
          <tr>
            <th style={S.th}>Query</th>
            <th style={S.th}>Skill</th>
            <th style={S.th}>Model</th>
            <th
              style={{ ...thStyle('hits'), ...S.thR }}
              onClick={() => toggleSort('hits')}
              aria-sort={sortCol === 'hits' ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
              data-testid="th-hits"
            >
              Hits{sortIndicator('hits')}
            </th>
            <th style={{ ...S.th, ...S.thR }}>Last hit</th>
            <th
              style={{ ...thStyle('dollarsSaved'), ...S.thR }}
              onClick={() => toggleSort('dollarsSaved')}
              aria-sort={sortCol === 'dollarsSaved' ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
              data-testid="th-dollars"
            >
              $ saved{sortIndicator('dollarsSaved')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={6} style={S.emptyCell} data-testid="top-queries-empty">
                No cached queries yet
                <span style={S.emptyHint}>
                  Enable RESPONSE_CACHE_ENABLED=true and reuse turns to populate.
                </span>
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr
                key={row.queryKey}
                onClick={() => handleRowClick(row)}
                style={{ cursor: row.originalSessionId ? 'pointer' : 'default' }}
                data-testid="top-query-row"
              >
                <td style={S.td}>
                  <div style={S.snippet}>{truncate(row.snippet)}</div>
                  <div style={S.snippetMeta}>
                    key: {row.queryKey.slice(0, 4)}…{row.queryKey.slice(-4)}
                  </div>
                </td>
                <td style={{ ...S.td, ...S.tdMono }}>{row.skill || '—'}</td>
                <td style={{ ...S.td, ...S.tdMono }}>{row.model || '—'}</td>
                <td style={{ ...S.td, ...S.tdMono, ...S.tdR }}>{row.hitCount}</td>
                <td style={{ ...S.td, ...S.tdMono, ...S.tdR }}>{fmtRelative(row.lastHitAt)}</td>
                <td style={{ ...S.td, ...S.tdMono, ...S.tdR, ...S.tdBrand }}>
                  {fmtDollars(row.dollarsSaved)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
