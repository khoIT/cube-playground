/**
 * Payer-tier migration card.
 *
 * When two daily member-state snapshots exist, renders the week-over-week
 * from→to tier matrix (rows = prev tier, cols = curr tier) plus upgrade /
 * downgrade / retained rollups. Cells are tinted by movement direction using
 * semantic status tokens (upgrade = positive, downgrade = destructive, stay =
 * muted). Covers only the tracked-segment cohort, disclosed via the footnote.
 *
 * When the read is gated off or fewer than two snapshot days exist, renders an
 * honest disclosed-empty state carrying the server's reason — never fabricated.
 */
import React from 'react';
import { formatCompact } from '../../OpsConsole/ops-format';
import type { TierMigrationData, TierMigrationCell } from './use-monetization-queries';
import { CoverageCadenceBar } from '../_hub/coverage-cadence-bar';

const PANEL: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-xl)',
  boxShadow: 'var(--shadow-sm)',
  padding: 16,
  fontFamily: 'var(--font-sans)',
};

/** Tier rank — lower index = higher value. Drives upgrade/downgrade direction. */
const TIER_RANK: Record<string, number> = {
  whale: 0,
  dolphin: 1,
  minnow: 2,
  non_payer: 3,
  unknown: 4,
};

const TIER_LABEL: Record<string, string> = {
  whale: 'Whale',
  dolphin: 'Dolphin',
  minnow: 'Minnow',
  non_payer: 'Non-payer',
  unknown: 'Unknown',
};

function rankOf(tier: string): number {
  return TIER_RANK[tier] ?? 99;
}

function labelOf(tier: string): string {
  return TIER_LABEL[tier] ?? tier;
}

/** Direction of a from→to move: 'up' (higher value), 'down', or 'stay'. */
function direction(from: string, to: string): 'up' | 'down' | 'stay' {
  const a = rankOf(from);
  const b = rankOf(to);
  if (b < a) return 'up';
  if (b > a) return 'down';
  return 'stay';
}

function cellTint(dir: 'up' | 'down' | 'stay'): { bg: string; ink: string } {
  if (dir === 'up') return { bg: 'var(--success-soft)', ink: 'var(--success-ink)' };
  if (dir === 'down') return { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)' };
  return { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)' };
}

function Header({ subtitle }: { subtitle?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>Tier migration (WoW)</div>
      {subtitle && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{subtitle}</div>}
    </div>
  );
}

export function TierMigrationCard({ data }: { data: TierMigrationData }) {
  const coverageMeta = {
    available: data.available,
    prevDate: data.prevDate,
    currDate: data.currDate,
    capturedDays: data.capturedDays,
    coverageUsers: data.coverageUsers,
  };

  if (!data.available || data.cells.length === 0) {
    return (
      <div style={PANEL}>
        <Header />
        <div style={{ marginBottom: 10 }}>
          <CoverageCadenceBar meta={coverageMeta} />
        </div>
        <div
          style={{
            padding: '12px 14px',
            background: 'var(--muted-soft)',
            borderRadius: 'var(--radius-md)',
            fontSize: 12.5,
            color: 'var(--muted-ink)',
            lineHeight: 1.5,
          }}
        >
          {data.reason}
        </div>
      </div>
    );
  }

  // Ordered distinct tiers present in the matrix (by rank).
  const tiers = [...new Set(data.cells.flatMap((c) => [c.from, c.to]))].sort((a, b) => rankOf(a) - rankOf(b));
  const cellAt = (from: string, to: string): TierMigrationCell | undefined =>
    data.cells.find((c) => c.from === from && c.to === to);

  let upgraded = 0;
  let downgraded = 0;
  let retained = 0;
  for (const c of data.cells) {
    const dir = direction(c.from, c.to);
    if (dir === 'up') upgraded += c.count;
    else if (dir === 'down') downgraded += c.count;
    else retained += c.count;
  }

  const th: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    padding: '4px 6px',
    textAlign: 'center',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={PANEL}>
      <Header subtitle={data.prevDate && data.currDate ? `${data.prevDate} → ${data.currDate}` : undefined} />

      <div style={{ marginBottom: 12 }}>
        <CoverageCadenceBar meta={coverageMeta} />
      </div>

      {/* Roll-up chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { label: 'Upgraded', value: upgraded, ink: 'var(--success-ink)', bg: 'var(--success-soft)' },
          { label: 'Retained', value: retained, ink: 'var(--muted-ink)', bg: 'var(--muted-soft)' },
          { label: 'Downgraded', value: downgraded, ink: 'var(--destructive-ink)', bg: 'var(--destructive-soft)' },
        ].map((chip) => (
          <div
            key={chip.label}
            style={{ background: chip.bg, borderRadius: 'var(--radius-md)', padding: '6px 10px', minWidth: 72 }}
          >
            <div style={{ fontSize: 10, fontWeight: 600, color: chip.ink, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {chip.label}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: chip.ink, lineHeight: 1.1 }}>
              {formatCompact(chip.value)}
            </div>
          </div>
        ))}
      </div>

      {/* From→to matrix */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'var(--font-sans)' }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>From ↓ / To →</th>
              {tiers.map((t) => (
                <th key={t} style={th}>
                  {labelOf(t)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tiers.map((from) => (
              <tr key={from}>
                <td style={{ ...th, textAlign: 'left', color: 'var(--text-primary)' }}>{labelOf(from)}</td>
                {tiers.map((to) => {
                  const cell = cellAt(from, to);
                  const count = cell?.count ?? 0;
                  if (count === 0) {
                    return (
                      <td key={to} style={{ padding: '4px 6px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
                        ·
                      </td>
                    );
                  }
                  const tint = cellTint(direction(from, to));
                  return (
                    <td key={to} style={{ padding: '4px 6px', textAlign: 'center' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          minWidth: 40,
                          padding: '3px 6px',
                          borderRadius: 'var(--radius-sm)',
                          background: tint.bg,
                          color: tint.ink,
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                        title={`${labelOf(from)} → ${labelOf(to)}: ${count.toLocaleString()}`}
                      >
                        {formatCompact(count)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>{data.reason}</div>
    </div>
  );
}
