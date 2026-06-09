/**
 * VIP LTV tier concept — mirrors the care registry's LTV bands (₫5 / 20 / 50 /
 * 100M, doc-defined). A VIP's tier is the highest band their cumulative LTV
 * clears. Surfaced as a badge across the CS console so "VIP tier reached" triage
 * shows *which* level a member sits at (the cohort spans all tiers, the badge
 * distinguishes them).
 *
 * Pure helper — keep the band thresholds here in lock-step with
 * server/src/care/playbook-registry.ts `LTV_BANDS`.
 */

export type TierLevel = 1 | 2 | 3 | 4;

interface TierBand {
  level: TierLevel;
  min: number;
  /** Compact threshold label for badges/tooltips. */
  short: string;
}

/** Ascending bands — the registry's ₫5/20/50/100M tiers. */
export const TIER_BANDS: TierBand[] = [
  { level: 1, min: 5_000_000, short: '₫5M' },
  { level: 2, min: 20_000_000, short: '₫20M' },
  { level: 3, min: 50_000_000, short: '₫50M' },
  { level: 4, min: 100_000_000, short: '₫100M' },
];

export interface VipTier {
  level: TierLevel;
  /** Threshold this tier starts at (VND). */
  threshold: number;
  /** Compact threshold label, e.g. "₫50M". */
  short: string;
}

/**
 * Resolves a cumulative-LTV value to its VIP tier (the highest band cleared), or
 * null when below the entry band / unknown.
 */
export function vipTier(ltvVnd: number | null | undefined): VipTier | null {
  if (ltvVnd == null || !Number.isFinite(ltvVnd)) return null;
  let match: TierBand | null = null;
  for (const b of TIER_BANDS) {
    if (ltvVnd >= b.min) match = b;
  }
  return match ? { level: match.level, threshold: match.min, short: match.short } : null;
}
