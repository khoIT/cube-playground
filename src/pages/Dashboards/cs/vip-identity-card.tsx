/**
 * VipIdentityCard — the shared VIP identity block for the Case Ledger rows
 * (By-Playbook + By-VIP). A monogram avatar anchors the row, followed by a
 * compact two-line identity:
 *
 *   ╭──╮  <name>  T4 ₫100M        ← avatar + display name (falls back to uid) + tier
 *   │BA│  ₫184M · whale · no-pay 44d · idle 32d   ← single muted meta line
 *   ╰──╯
 *
 * The avatar colour encodes the VIP tier (brand=T4, amber=T3, blue=T2) so the
 * tier reads at a glance; below the entry band it falls back to a theme-aware
 * inverse mono pill. The meta line condenses LTV · payer-tier · churn onto one
 * row (full text in the hover tooltip), so an un-enriched VIP degrades to just
 * the avatar + name. Tokens only.
 */

import React from 'react';
import { VipTierBadge } from './vip-tier-badge';
import { vipTier, type TierLevel } from './vip-tier';
import { ltvLabel } from './case-ledger-format';
import { formatValueExact } from '../../Segments/detail/cards/format-value';
import type { CareVipProfileDto } from './use-care-cases';

interface VipIdentityCardProps {
  uid: string;
  profile?: CareVipProfileDto | null;
  /** Badges rendered inline after the name (multi-match, lapsed, …). */
  trailing?: React.ReactNode;
}

/** Up-to-two-letter monogram from the display name (or uid): first letters of
 *  the first two word-parts, else the first two characters of a single token. */
function initialsFor(name: string | null | undefined, uid: string): string {
  const src = (name ?? uid ?? '').trim();
  if (!src) return '?';
  const tokens = src.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (tokens.length >= 2) return (tokens[0][0] + tokens[1][0]).toUpperCase();
  return (tokens[0] ?? src).slice(0, 2).toUpperCase();
}

// Tier-tinted avatar fills, keyed by tier level. T2–T4 use the semantic
// soft/ink pairs (already dark-mode aware) with a matching inset ring; T1 and
// un-tiered VIPs fall through to the mono inverse pill below.
const AVATAR_TINT: Partial<Record<TierLevel, React.CSSProperties>> = {
  4: { background: 'var(--brand-soft)', color: 'var(--brand-hover)', boxShadow: 'inset 0 0 0 1.5px var(--brand)' },
  3: { background: 'var(--warning-soft)', color: 'var(--warning-ink)', boxShadow: 'inset 0 0 0 1.5px var(--warning)' },
  2: { background: 'var(--info-soft)', color: 'var(--info-ink)', boxShadow: 'inset 0 0 0 1.5px var(--info)' },
};

// Theme-aware inverse pill: dark circle on light theme, light circle on dark.
const AVATAR_MONO: React.CSSProperties = { background: 'var(--text-primary)', color: 'var(--bg-card)' };

function VipAvatar({ name, uid, ltvVnd }: { name: string | null | undefined; uid: string; ltvVnd?: number | null }) {
  const tier = vipTier(ltvVnd);
  const tint = tier && tier.level >= 2 ? AVATAR_TINT[tier.level] : undefined;
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: 32,
        height: 32,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 'var(--radius-full)',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.01em',
        fontVariantNumeric: 'tabular-nums',
        fontFamily: 'var(--font-sans)',
        ...(tint ?? AVATAR_MONO),
      }}
    >
      {initialsFor(name, uid)}
    </span>
  );
}

const NUM_STYLE: React.CSSProperties = {
  color: 'var(--text-secondary)',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};

export function VipIdentityCard({ uid, profile, trailing }: VipIdentityCardProps) {
  const name = profile?.name ?? uid;
  const hasLtv = profile?.ltvVnd != null;
  const hasChurn =
    profile != null && (profile.churnPayDays != null || profile.churnPlayDays != null);

  // Assemble the one-line meta from whichever fields are present, joined with
  // a muted middot. Empty when the VIP is un-enriched (degrades to name only).
  const metaParts: React.ReactNode[] = [];
  if (hasLtv) metaParts.push(<span key="ltv" style={NUM_STYLE}>{ltvLabel(profile!.ltvVnd)}</span>);
  if (profile?.tier) metaParts.push(<span key="tier">{profile.tier}</span>);
  if (hasChurn) {
    metaParts.push(
      <span key="churn">
        no-pay <span style={NUM_STYLE}>{profile!.churnPayDays ?? '—'}d</span>
        {' · '}idle <span style={NUM_STYLE}>{profile!.churnPlayDays ?? '—'}d</span>
      </span>,
    );
  }

  // Plain-text mirror for the hover tooltip (avatars/ellipsis can clip the line).
  const metaText = [
    hasLtv ? (formatValueExact(profile!.ltvVnd!, 'currency') ?? ltvLabel(profile!.ltvVnd)) : null,
    profile?.tier ?? null,
    hasChurn ? `no-pay ${profile!.churnPayDays ?? '—'}d · idle ${profile!.churnPlayDays ?? '—'}d` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
      <VipAvatar name={profile?.name} uid={uid} ltvVnd={profile?.ltvVnd} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        {/* Name + tier badge + any trailing badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span
            title={uid}
            style={{
              fontWeight: 700,
              fontSize: 13.5,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)',
              maxWidth: 190,
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

        {/* Single condensed meta line — LTV · payer-tier · churn */}
        {metaParts.length > 0 && (
          <div
            title={metaText}
            style={{
              fontSize: 11.5,
              fontFamily: 'var(--font-sans)',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {metaParts.map((part, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span style={{ opacity: 0.55 }}> · </span>}
                {part}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
