/**
 * VIP tier badge — a compact "T1..T4" pill tinted by level, with the revenue
 * threshold in the tooltip. Renders nothing when the LTV is below the entry band
 * or unknown. Tokens only; the tint deepens with the tier so the top tier (T4)
 * carries the brand accent.
 */

import { vipTier, type TierLevel } from './vip-tier';

const TIER_TINT: Record<TierLevel, React.CSSProperties> = {
  1: { background: 'var(--muted-soft)', color: 'var(--muted-ink)' },
  2: { background: 'var(--info-soft)', color: 'var(--info-ink)' },
  3: { background: 'var(--warning-soft)', color: 'var(--warning-ink)' },
  4: { background: 'var(--brand-soft)', color: 'var(--brand-hover)' },
};

interface VipTierBadgeProps {
  ltvVnd: number | null | undefined;
  /** sm = inline row chip; md = slightly larger for headers. */
  size?: 'sm' | 'md';
}

export function VipTierBadge({ ltvVnd, size = 'sm' }: VipTierBadgeProps) {
  const tier = vipTier(ltvVnd);
  if (!tier) return null;
  const md = size === 'md';
  return (
    <span
      title={`VIP Tier ${tier.level} — cumulative LTV ≥ ${tier.short}`}
      style={{
        ...TIER_TINT[tier.level],
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: md ? 11 : 10,
        fontWeight: 700,
        padding: md ? '2px 9px' : '1px 7px',
        borderRadius: 'var(--radius-full)',
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
        fontFamily: 'var(--font-sans)',
        letterSpacing: '0.02em',
      }}
    >
      T{tier.level}
      <span style={{ opacity: 0.7, fontWeight: 600 }}>{tier.short}</span>
    </span>
  );
}
