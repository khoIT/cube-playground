/**
 * PortfolioRow — one row in the cross-title portfolio grid.
 *
 * Columns: rank · game · DAU (Δ) · Revenue (Δ) · Paying · ARPDAU ·
 *          Rev share · Health flag · drill arrow.
 *
 * Degradation: loading → skeleton shimmer; error → "—" cells with tooltip;
 * null values → "—" (measure not available for that game).
 * Health flag: red dot if open anomalies > 0 (count shown in tooltip),
 *              green dot otherwise.
 */

import type { CSSProperties } from 'react';
import type { PortfolioRow as PortfolioRowData } from './use-portfolio';

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtNum(v: number | null): string {
  if (v == null) return '—';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

function fmtVnd(v: number | null): string {
  if (v == null) return '—';
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
  return v.toLocaleString();
}

function fmtDelta(v: number | null): { text: string; positive: boolean; negative: boolean } {
  if (v == null) return { text: '', positive: false, negative: false };
  const pct = (v * 100).toFixed(1);
  return {
    text: `${v > 0 ? '+' : ''}${pct}%`,
    positive: v > 0,
    negative: v < 0,
  };
}

function fmtShare(v: number | null): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const cellBase: CSSProperties = {
  padding: '10px 12px',
  fontSize: 13,
  fontFamily: 'var(--font-sans)',
  fontVariantNumeric: 'tabular-nums',
  borderBottom: '1px solid var(--border-card)',
  color: 'var(--text-primary)',
  verticalAlign: 'middle',
};

const mutedCell: CSSProperties = {
  ...cellBase,
  color: 'var(--text-muted)',
};

// ── Skeleton shimmer ──────────────────────────────────────────────────────────

function SkeletonCell() {
  return (
    <td style={cellBase}>
      <div
        style={{
          height: 14,
          width: '60%',
          borderRadius: 4,
          background: 'var(--bg-muted)',
          opacity: 0.6,
        }}
      />
    </td>
  );
}

// ── Delta chip ────────────────────────────────────────────────────────────────

function DeltaChip({ delta }: { delta: number | null }) {
  const { text, positive, negative } = fmtDelta(delta);
  if (!text) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: positive ? 'var(--positive)' : negative ? 'var(--negative)' : 'var(--text-muted)',
        marginLeft: 4,
      }}
    >
      {text}
    </span>
  );
}

// ── Health dot ────────────────────────────────────────────────────────────────

function HealthDot({ count }: { count: number }) {
  const hasIssues = count > 0;
  return (
    <span
      title={hasIssues ? `${count} open anomal${count === 1 ? 'y' : 'ies'}` : 'No open anomalies'}
      style={{ cursor: hasIssues ? 'help' : 'default' }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: hasIssues ? 'var(--danger)' : 'var(--positive)',
          marginRight: hasIssues ? 5 : 0,
        }}
      />
      {hasIssues && (
        <span style={{ fontSize: 11, color: 'var(--destructive-ink)', fontWeight: 600 }}>
          {count}
        </span>
      )}
    </span>
  );
}

// ── Game avatar mark ──────────────────────────────────────────────────────────

function GameMark({ mark, name }: { mark?: string; name: string }) {
  return (
    <span
      title={name}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        borderRadius: 6,
        background: 'var(--bg-muted)',
        fontSize: 10,
        fontWeight: 700,
        color: 'var(--text-muted)',
        flexShrink: 0,
        letterSpacing: '-0.01em',
      }}
    >
      {mark ?? name.slice(0, 2).toUpperCase()}
    </span>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

interface Props {
  row: PortfolioRowData;
  onClick: () => void;
}

const NUM_SKELETON_CELLS = 7;

export function PortfolioTableRow({ row, onClick }: Props) {
  const { game, loading, error } = row;

  return (
    <tr
      onClick={onClick}
      style={{
        cursor: 'pointer',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLTableRowElement).style.background = 'var(--bg-muted)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLTableRowElement).style.background = '';
      }}
    >
      {/* Rank */}
      <td style={{ ...mutedCell, textAlign: 'center', width: 36 }}>
        {loading ? (
          <div style={{ height: 14, width: 16, borderRadius: 3, background: 'var(--bg-muted)' }} />
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600 }}>{row.revRank}</span>
        )}
      </td>

      {/* Game name + mark */}
      <td style={{ ...cellBase, minWidth: 140 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GameMark mark={game.mark} name={game.name} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              {game.name}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{game.id}</div>
          </div>
        </div>
      </td>

      {/* Skeleton for all data cells when loading */}
      {loading ? (
        Array.from({ length: NUM_SKELETON_CELLS }).map((_, i) => <SkeletonCell key={i} />)
      ) : error ? (
        // Error state — show "—" across all data cells with tooltip on first
        <>
          <td style={mutedCell} colSpan={NUM_SKELETON_CELLS}>
            <span title={`Load failed: ${error}`} style={{ cursor: 'help', color: 'var(--text-muted)' }}>
              — data unavailable
            </span>
          </td>
        </>
      ) : (
        <>
          {/* DAU + Δ */}
          <td style={cellBase}>
            {fmtNum(row.dau)}
            <DeltaChip delta={row.dauDelta} />
          </td>

          {/* Revenue + Δ */}
          <td style={cellBase}>
            {fmtVnd(row.revenue)}
            <DeltaChip delta={row.revDelta} />
          </td>

          {/* Paying users */}
          <td style={cellBase}>{fmtNum(row.paying)}</td>

          {/* ARPDAU */}
          <td style={cellBase}>{fmtVnd(row.arpdau)}</td>

          {/* Revenue share bar */}
          <td style={{ ...cellBase, minWidth: 90 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 48,
                  height: 4,
                  borderRadius: 2,
                  background: 'var(--bg-muted)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.round((row.revShare ?? 0) * 100)}%`,
                    background: 'var(--brand)',
                    borderRadius: 2,
                  }}
                />
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {fmtShare(row.revShare)}
              </span>
            </div>
          </td>

          {/* Health flag */}
          <td style={{ ...cellBase, textAlign: 'center' }}>
            <HealthDot count={row.openAnomalies} />
          </td>

          {/* Drill arrow */}
          <td style={{ ...mutedCell, textAlign: 'center', width: 32, paddingRight: 16 }}>
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>›</span>
          </td>
        </>
      )}
    </tr>
  );
}
