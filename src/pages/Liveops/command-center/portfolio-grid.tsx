/**
 * PortfolioGrid — cross-title ranked table for the Command Center "All games" mode.
 *
 * Sortable columns: Revenue (default desc), DAU, Paying, ARPDAU, Rev share, Anomalies.
 * Row click → setGameId(game) + flip toggle back to "This game" (drill-in).
 *
 * Loading state: each row shows skeleton shimmer independently (per-game isolation).
 * Error state: failed rows show "— data unavailable" without blanking neighbours.
 */

import { useState, type CSSProperties } from 'react';
import { usePortfolio, type PortfolioRow } from './use-portfolio';
import { PortfolioTableRow } from './portfolio-row';
import type { GameDef } from '../../../types/segment-api';

// ── Sort state ────────────────────────────────────────────────────────────────

type SortCol = 'revenue' | 'dau' | 'paying' | 'arpdau' | 'revShare' | 'anomalies';
type SortDir = 'asc' | 'desc';

function sortRows(rows: PortfolioRow[], col: SortCol, dir: SortDir): PortfolioRow[] {
  return [...rows].sort((a, b) => {
    const va = colValue(a, col) ?? -Infinity;
    const vb = colValue(b, col) ?? -Infinity;
    return dir === 'desc' ? vb - va : va - vb;
  });
}

function colValue(row: PortfolioRow, col: SortCol): number | null {
  switch (col) {
    case 'revenue':   return row.revenue;
    case 'dau':       return row.dau;
    case 'paying':    return row.paying;
    case 'arpdau':    return row.arpdau;
    case 'revShare':  return row.revShare;
    case 'anomalies': return row.openAnomalies;
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const tableWrap: CSSProperties = {
  overflowX: 'auto',
  borderRadius: 'var(--radius-lg)',
  border: '1px solid var(--border-card)',
  background: 'var(--bg-card)',
};

const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: 'var(--font-sans)',
};

const thBase: CSSProperties = {
  padding: '9px 12px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  textAlign: 'left',
  borderBottom: '1px solid var(--border-card)',
  background: 'var(--bg-subtle, var(--bg-muted))',
  userSelect: 'none',
  whiteSpace: 'nowrap',
};

const thSortable: CSSProperties = {
  ...thBase,
  cursor: 'pointer',
};

// ── Sortable header cell ──────────────────────────────────────────────────────

interface ThProps {
  col: SortCol;
  active: SortCol;
  dir: SortDir;
  label: string;
  onClick: (col: SortCol) => void;
  style?: CSSProperties;
}

function SortableTh({ col, active, dir, label, onClick, style }: ThProps) {
  const isActive = col === active;
  return (
    <th
      style={{ ...thSortable, color: isActive ? 'var(--text-primary)' : 'var(--text-muted)', ...style }}
      onClick={() => onClick(col)}
    >
      {label}
      {isActive ? (dir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  );
}

// ── Summary strip ─────────────────────────────────────────────────────────────

function fmtVndShort(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
  return v.toLocaleString();
}

function SummaryStrip({ rows, totalRevenue }: { rows: PortfolioRow[]; totalRevenue: number }) {
  const totalDau = rows.reduce((s, r) => s + (r.dau ?? 0), 0);
  const anomalousTitles = rows.filter((r) => r.openAnomalies > 0).length;

  return (
    <div
      style={{
        display: 'flex',
        gap: 24,
        padding: '10px 14px',
        borderBottom: '1px solid var(--border-card)',
        background: 'var(--bg-subtle, var(--bg-muted))',
        fontSize: 12,
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-sans)',
        flexWrap: 'wrap',
      }}
    >
      <span>
        <strong style={{ color: 'var(--text-primary)', marginRight: 3 }}>{rows.length}</strong>
        titles
      </span>
      <span>
        <strong style={{ color: 'var(--text-primary)', marginRight: 3 }}>
          {totalDau >= 1_000 ? `${(totalDau / 1_000).toFixed(0)}K` : totalDau.toLocaleString()}
        </strong>
        total DAU
      </span>
      <span>
        <strong style={{ color: 'var(--text-primary)', marginRight: 3 }}>
          {fmtVndShort(totalRevenue)} VND
        </strong>
        portfolio revenue
      </span>
      {anomalousTitles > 0 && (
        <span style={{ color: 'var(--destructive-ink)', fontWeight: 600 }}>
          ⚠ {anomalousTitles} title{anomalousTitles > 1 ? 's' : ''} with open anomalies
        </span>
      )}
    </div>
  );
}

// ── Grid ──────────────────────────────────────────────────────────────────────

interface Props {
  games: GameDef[];
  /** Called when user clicks a row to drill into a single-game view. */
  onDrillIn: (gameId: string) => void;
}

export function PortfolioGrid({ games, onDrillIn }: Props) {
  const { rows, loading, totalRevenue } = usePortfolio(games);
  const [sortCol, setSortCol] = useState<SortCol>('revenue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (col: SortCol) => {
    if (col === sortCol) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  };

  const sorted = sortRows(rows, sortCol, sortDir);

  if (!loading && rows.length === 0) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 13,
          fontFamily: 'var(--font-sans)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        No games available in this workspace.
      </div>
    );
  }

  return (
    <div>
      <div style={tableWrap}>
        {!loading && <SummaryStrip rows={rows} totalRevenue={totalRevenue} />}
        <table style={table}>
          <thead>
            <tr>
              <th style={{ ...thBase, textAlign: 'center', width: 36 }}>#</th>
              <th style={thBase}>Game</th>
              <SortableTh col="dau"       active={sortCol} dir={sortDir} label="DAU"       onClick={handleSort} />
              <SortableTh col="revenue"   active={sortCol} dir={sortDir} label="Revenue"   onClick={handleSort} />
              <SortableTh col="paying"    active={sortCol} dir={sortDir} label="Payers"    onClick={handleSort} />
              <SortableTh col="arpdau"    active={sortCol} dir={sortDir} label="ARPDAU"    onClick={handleSort} />
              <SortableTh col="revShare"  active={sortCol} dir={sortDir} label="Rev share" onClick={handleSort} style={{ minWidth: 110 }} />
              <SortableTh col="anomalies" active={sortCol} dir={sortDir} label="Health"    onClick={handleSort} style={{ textAlign: 'center' }} />
              <th style={{ ...thBase, width: 32 }} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <PortfolioTableRow
                key={row.game.id}
                row={row}
                onClick={() => onDrillIn(row.game.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p
        style={{
          marginTop: 8,
          fontSize: 11,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        KPIs from the last-cache-window snapshot · click a row to drill into single-game Command Center
      </p>
    </div>
  );
}
