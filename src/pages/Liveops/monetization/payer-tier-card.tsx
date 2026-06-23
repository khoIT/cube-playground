/**
 * Payer-tier distribution card.
 *
 * Renders whale / dolphin / minnow / non_payer counts + LTV share bars.
 * Tier badges reuse the same semantic-token palette as members-top-payers.tsx
 * (whale = brand-soft, dolphin = info-soft, minnow = success-soft).
 * Also shows the Gini coefficient as a revenue-concentration headline.
 */
import React from 'react';
import { BarList, type BarListItem } from '../../Segments/visuals/bar-list';
import { formatVnd, formatCompact, formatPct } from '../../OpsConsole/ops-format';
import type { PayerTierData, TierRow } from './use-monetization-queries';

// Panel wrapper matching overview-tab.tsx Panel style.
function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-sm)',
        padding: 16,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
        {note && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{note}</div>}
      </div>
      {children}
    </div>
  );
}

/** Semantic-token badge colors per payer tier — mirrors members-top-payers.tsx. */
function tierColor(tier: string): string {
  switch (tier.toLowerCase()) {
    case 'whale':    return 'var(--brand)';
    case 'dolphin':  return 'var(--info-ink)';
    case 'minnow':   return 'var(--success-ink)';
    default:         return 'var(--muted-ink)';
  }
}

function tierBadgeStyle(tier: string): React.CSSProperties {
  switch (tier.toLowerCase()) {
    case 'whale':
      return { background: 'var(--brand-soft)', color: 'var(--brand-hover)' };
    case 'dolphin':
      return { background: 'var(--info-soft)', color: 'var(--info-ink)' };
    case 'minnow':
      return { background: 'var(--success-soft)', color: 'var(--success-ink)' };
    default:
      return { background: 'var(--muted-soft)', color: 'var(--muted-ink)' };
  }
}

function TierBadge({ tier }: { tier: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 'var(--radius-full)',
        textTransform: 'capitalize',
        ...tierBadgeStyle(tier),
      }}
    >
      {tier === 'non_payer' ? 'non-payer' : tier}
    </span>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  );
}

interface Props {
  data: PayerTierData;
}

export function PayerTierCard({ data }: Props) {
  const payingTiers = data.tiers.filter((t) => t.tier !== 'non_payer');

  // Revenue-share bar list — one bar per paying tier, width = ltvPct.
  const ltvItems: BarListItem[] = payingTiers.map((t) => ({
    label: t.tier === 'non_payer' ? 'non-payer' : t.tier.charAt(0).toUpperCase() + t.tier.slice(1),
    value: Math.round(t.ltvPct * 1000) / 10, // as percent 0-100
    color: tierColor(t.tier),
  }));

  return (
    <Panel title="Payer-tier distribution" note="mf_users snapshot">
      {/* Headline stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <StatChip label="Total payers" value={formatCompact(data.totalPayers)} />
        <StatChip label="Lifetime LTV" value={formatVnd(data.totalLtv)} />
        <StatChip
          label="Gini (LTV conc.)"
          value={data.giniApprox.toFixed(2)}
        />
      </div>

      {/* Tier table */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        {data.tiers.map((t: TierRow) => (
          <div
            key={t.tier}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              background: 'var(--bg-muted)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12.5,
            }}
          >
            <TierBadge tier={t.tier} />
            <span style={{ flex: 1, color: 'var(--text-muted)' }}>
              {formatCompact(t.count)} users
            </span>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {formatVnd(t.ltv)}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 36, textAlign: 'right' }}>
              {formatPct(t.ltvPct, 1)}
            </span>
          </div>
        ))}
      </div>

      {/* Revenue-share bars (paying tiers only) */}
      {ltvItems.length > 0 && (
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Revenue share (%)
          </div>
          <BarList items={ltvItems} max={100} />
        </div>
      )}

      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10 }}>
        Gini ≈ {data.giniApprox.toFixed(2)} — closer to 1 means more revenue concentrated in fewer payers.
        Tier thresholds: whale ≥ ₫10M lifetime · dolphin ≥ ₫1M · minnow &gt; ₫0.
      </div>
    </Panel>
  );
}
