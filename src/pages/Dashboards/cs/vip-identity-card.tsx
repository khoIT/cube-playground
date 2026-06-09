/**
 * VipIdentityCard — the shared VIP identity block for the Case Ledger rows
 * (By-Playbook + By-VIP). Renders the persisted profile snapshot as a compact
 * three-line card:
 *
 *   <name>  T<tier>            ← display name (falls back to uid) + tier badge
 *   ₫8.75M · dolphin           ← compact LTV + payer tier
 *   no-pay 44d · idle 32d      ← churn: days since last recharge / last active
 *
 * Lines below the name only render when the underlying profile fields are
 * present, so an un-enriched VIP degrades to just the name/uid. Tokens only.
 */

import React from 'react';
import { VipTierBadge } from './vip-tier-badge';
import { ltvLabel } from './case-ledger-format';
import { formatValueExact } from '../../Segments/detail/cards/format-value';
import type { CareVipProfileDto } from './use-care-cases';

interface VipIdentityCardProps {
  uid: string;
  profile?: CareVipProfileDto | null;
  /** Badges rendered inline after the name (multi-match, lapsed, …). */
  trailing?: React.ReactNode;
}

export function VipIdentityCard({ uid, profile, trailing }: VipIdentityCardProps) {
  const name = profile?.name ?? uid;
  const hasLtv = profile?.ltvVnd != null;
  const hasIdLine = hasLtv || !!profile?.tier;
  const hasChurn =
    profile != null && (profile.churnPayDays != null || profile.churnPlayDays != null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      {/* Name + tier badge + any trailing badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <span
          title={uid}
          style={{
            fontWeight: 700,
            fontSize: 13.5,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-sans)',
            maxWidth: 200,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </span>
        <VipTierBadge ltvVnd={profile?.ltvVnd} />
        {trailing}
      </div>

      {/* LTV · payer tier */}
      {hasIdLine && (
        <div
          style={{ fontSize: 12, fontFamily: 'var(--font-sans)', color: 'var(--text-muted)' }}
          title={hasLtv ? (formatValueExact(profile!.ltvVnd!, 'currency') ?? undefined) : undefined}
        >
          {hasLtv && (
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {ltvLabel(profile!.ltvVnd)}
            </span>
          )}
          {hasLtv && profile?.tier ? ' · ' : ''}
          {profile?.tier ?? ''}
        </div>
      )}

      {/* Churn: days since last recharge / last active */}
      {hasChurn && (
        <div style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--text-muted)' }}>
          no-pay{' '}
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {profile!.churnPayDays ?? '—'}d
          </span>
          {' · '}idle{' '}
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {profile!.churnPlayDays ?? '—'}d
          </span>
        </div>
      )}
    </div>
  );
}
