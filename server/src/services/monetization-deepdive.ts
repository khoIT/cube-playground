/**
 * Monetization deep-dive data service.
 *
 * Provides three aggregate-only computations the FE cannot derive in a single
 * Cube query:
 *
 * 1. Payer-tier distribution — user counts + LTV per tier (could be FE-direct
 *    but the server enriches it with ltvPct and Gini in one call).
 * 2. Realized LTV-by-cohort matrix — cumulative mf_users LTV grouped by
 *    install_month × current age-band. Age is computed from install_month to
 *    CURRENT_DATE at query time (snapshot grain — no history). Capped at 90 days.
 * 3. SKU performance — top-N SKUs by VND revenue from recharge cube.
 *    Gate: cfm_vn and jus_vn only. jus requires currency='VND' filter.
 *
 * All results are aggregate-only — no user_id exposed.
 */

import { load } from './cube-client.js';
import { resolveCubeTokenForGame } from './resolve-cube-token.js';
import { readTierMigration, type TransitionCell } from '../lakehouse/state-transition-reader.js';
import { transitionsReadEnabled, TRANSITIONS_DISABLED_REASON } from './transition-read-gate.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TierRow {
  tier: string;
  count: number;
  ltv: number;
  ltvPct: number;
}

export interface PayerTierResult {
  snapshotAt: string;
  tiers: TierRow[];
  /** Gini coefficient of LTV distribution across tiers (0 = flat, 1 = all to one). */
  giniApprox: number;
  totalPayers: number;
  totalLtv: number;
}

export interface CohortLtvRow {
  /** Install month label e.g. "2025-01". */
  installMonth: string;
  /** Age-band label, e.g. "D0-30" | "D31-60" | "D61-90". */
  ageBand: string;
  /** Cumulative LTV (sum of mf_users.ltv_total_vnd for this cohort). */
  cumulativeLtv: number;
  /** Count of payers in this cohort. */
  payerCount: number;
}

export interface CohortLtvResult {
  snapshotAt: string;
  rows: CohortLtvRow[];
  note: string;
}

export interface SkuRow {
  productId: string;
  /** Human-readable name; cfm has no product_name so falls back to productId. */
  productName: string;
  revenue: number;
  txnCount: number;
}

export interface SkuResult {
  snapshotAt: string;
  rows: SkuRow[];
  /** True when SKU data is not available for this game. */
  notAvailable: boolean;
  notAvailableReason?: string;
}

export interface TierMigrationResult {
  snapshotAt: string;
  available: boolean;
  prevDate: string | null;
  currDate: string | null;
  capturedDays: number;
  coverageUsers: number;
  /** From→to payer-tier movement cells (whale/dolphin/minnow/non_payer/unknown). */
  cells: TransitionCell[];
  /** Disclosure: coverage note when available, why-empty reason when not. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Payer-tier distribution + Gini
// ---------------------------------------------------------------------------

interface CubeTierRow {
  'mf_users.payer_tier': string;
  'mf_users.user_count': number | string;
  'mf_users.ltv_total_vnd': number | string;
}

/**
 * Approximate Gini coefficient from discrete tier buckets.
 * Treats each tier as a single "agent" with its aggregated LTV share.
 * Low resolution (4 tiers) but directionally correct.
 */
function computeGini(tiers: TierRow[]): number {
  const paying = tiers.filter((t) => t.tier !== 'non_payer' && t.ltv > 0);
  if (paying.length < 2) return paying.length === 1 ? 1 : 0;
  // Sort ascending by ltv.
  const sorted = [...paying].sort((a, b) => a.ltv - b.ltv);
  const n = sorted.length;
  const totalLtv = sorted.reduce((s, t) => s + t.ltv, 0);
  if (totalLtv === 0) return 0;
  // Gini = 1 - 2 * B where B = area under Lorenz curve (trapezoid sum).
  let cumulative = 0;
  let lorenzArea = 0;
  for (let i = 0; i < n; i++) {
    const prevFrac = cumulative / totalLtv;
    cumulative += sorted[i].ltv;
    const curFrac = cumulative / totalLtv;
    lorenzArea += ((prevFrac + curFrac) / 2) * (1 / n);
  }
  return Math.max(0, Math.min(1, 1 - 2 * lorenzArea));
}

export async function fetchPayerTierDistribution(game: string): Promise<PayerTierResult> {
  const token = resolveCubeTokenForGame(game) ?? undefined;
  const query = {
    measures: ['mf_users.user_count', 'mf_users.ltv_total_vnd'],
    dimensions: ['mf_users.payer_tier'],
    limit: 20,
  };

  const result = (await load(query, token, 60_000)) as { data: CubeTierRow[] };
  const rows: CubeTierRow[] = result?.data ?? [];

  const totalLtv = rows.reduce((s, r) => s + Number(r['mf_users.ltv_total_vnd'] ?? 0), 0);
  const totalPayers = rows
    .filter((r) => r['mf_users.payer_tier'] !== 'non_payer')
    .reduce((s, r) => s + Number(r['mf_users.user_count'] ?? 0), 0);

  const tiers: TierRow[] = rows.map((r) => {
    const ltv = Number(r['mf_users.ltv_total_vnd'] ?? 0);
    return {
      tier: String(r['mf_users.payer_tier'] ?? 'unknown'),
      count: Number(r['mf_users.user_count'] ?? 0),
      ltv,
      ltvPct: totalLtv > 0 ? ltv / totalLtv : 0,
    };
  });

  const tierOrder = ['whale', 'dolphin', 'minnow', 'non_payer'];
  tiers.sort((a, b) => {
    const ai = tierOrder.indexOf(a.tier);
    const bi = tierOrder.indexOf(b.tier);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return {
    snapshotAt: new Date().toISOString(),
    tiers,
    giniApprox: computeGini(tiers),
    totalPayers,
    totalLtv,
  };
}

/**
 * Week-over-week payer-tier migration — a from→to matrix self-joined from the
 * two latest daily member-state snapshots. Gated + isolated like the lifecycle
 * transitions: a disabled read or fewer than two snapshot days returns an honest
 * disclosed-empty result (no warehouse call when disabled). Covers only the
 * tracked-segment cohort, disclosed via `reason`.
 */
export async function fetchTierMigration(game: string): Promise<TierMigrationResult> {
  const snapshotAt = new Date().toISOString();
  const empty: TierMigrationResult = {
    snapshotAt,
    available: false,
    prevDate: null,
    currDate: null,
    capturedDays: 0,
    coverageUsers: 0,
    cells: [],
    reason: TRANSITIONS_DISABLED_REASON,
  };

  if (!transitionsReadEnabled()) return empty;

  try {
    const matrix = await readTierMigration(game);
    return {
      snapshotAt,
      available: matrix.available,
      prevDate: matrix.prevDate,
      currDate: matrix.currDate,
      capturedDays: matrix.capturedDays,
      coverageUsers: matrix.coverageUsers,
      cells: matrix.available ? matrix.cells : [],
      reason: matrix.reason,
    };
  } catch (err) {
    return { ...empty, reason: `Tier migration read failed: ${(err as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Realized LTV-by-cohort (install_month × age-band)
//
// mf_users stores current LTV (lifetime cumulative) and install_month.
// Age-band = how many days the cohort has aged as of today. We derive this
// from install_month: age ≈ days since the 1st of that month. Cap at 90 days.
// ---------------------------------------------------------------------------

const AGE_BANDS = [
  { label: 'D0-30', minDays: 0, maxDays: 30 },
  { label: 'D31-60', minDays: 31, maxDays: 60 },
  { label: 'D61-90', minDays: 61, maxDays: 90 },
] as const;

interface CubeCohortRow {
  'mf_users.install_month': string;
  'mf_users.ltv_total_vnd': number | string;
  'mf_users.paying_users': number | string;
}

export async function fetchCohortLtv(game: string): Promise<CohortLtvResult> {
  const token = resolveCubeTokenForGame(game) ?? undefined;
  // Query install_month + LTV sum + paying_users count.
  // install_month is a string dimension (YYYY-MM format) — not a time dim,
  // so no dateRange filter; we filter age-band in post-processing.
  const query = {
    measures: ['mf_users.ltv_total_vnd', 'mf_users.paying_users'],
    dimensions: ['mf_users.install_month'],
    filters: [
      // Only cohorts installed in the last ~90 days window to bound Trino scan.
      // install_month ≥ 3 months ago (YYYY-MM string comparison works lexicographically).
      { member: 'mf_users.install_month', operator: 'gte', values: [getMonthsAgo(4)] },
      // Exclude null install_month (organic/pre-attribution users with no MMP signal).
      { member: 'mf_users.install_month', operator: 'set' },
    ],
    limit: 50,
  };

  const result = (await load(query, token, 90_000)) as { data: CubeCohortRow[] };
  const cubeRows: CubeCohortRow[] = result?.data ?? [];

  const today = new Date();
  const outputRows: CohortLtvRow[] = [];

  for (const r of cubeRows) {
    const monthStr = String(r['mf_users.install_month'] ?? '');
    if (!monthStr || monthStr.length < 7) continue;
    // Age = days from the 1st of that month to today.
    const cohortStart = new Date(monthStr + '-01T00:00:00Z');
    const ageDays = Math.floor((today.getTime() - cohortStart.getTime()) / 86_400_000);

    // Map to age band; skip if > 90 days (out of scope).
    const band = AGE_BANDS.find((b) => ageDays >= b.minDays && ageDays <= b.maxDays);
    if (!band) continue;

    outputRows.push({
      installMonth: monthStr,
      ageBand: band.label,
      cumulativeLtv: Number(r['mf_users.ltv_total_vnd'] ?? 0),
      payerCount: Number(r['mf_users.paying_users'] ?? 0),
    });
  }

  return {
    snapshotAt: new Date().toISOString(),
    rows: outputRows,
    note:
      'LTV is cumulative lifetime revenue at snapshot time — not a per-age-increment. ' +
      'Age-band derived from install_month to today. ' +
      'Covers install cohorts from the last 90 days only.',
  };
}

/** Return YYYY-MM string for N months ago. */
function getMonthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// SKU performance (cfm_vn + jus_vn only)
// ---------------------------------------------------------------------------

/** Games that have SKU data in the recharge cube. */
const SKU_SUPPORTED_GAMES = new Set(['cfm_vn', 'jus_vn']);

interface CfmSkuRow {
  'recharge.product_id': string;
  'recharge.revenue_vnd_real': number | string;
  'recharge.transactions': number | string;
}

interface JusSkuRow {
  'recharge.product_id': string;
  'recharge.product_name': string;
  'recharge.revenue_vnd': number | string;
  'recharge.transactions': number | string;
}

export async function fetchSkuPerformance(game: string, limit = 20): Promise<SkuResult> {
  if (!SKU_SUPPORTED_GAMES.has(game)) {
    return {
      snapshotAt: new Date().toISOString(),
      rows: [],
      notAvailable: true,
      notAvailableReason: `SKU/pack data is only available for cfm_vn and jus_vn. Game "${game}" uses a different recharge schema without product dimensions.`,
    };
  }

  const token = resolveCubeTokenForGame(game) ?? undefined;

  if (game === 'cfm_vn') {
    const query = {
      measures: ['recharge.revenue_vnd_real', 'recharge.transactions'],
      dimensions: ['recharge.product_id'],
      // Filter only bridged (real) transactions — unbridged are NULL on revenue_vnd_real.
      filters: [{ member: 'recharge.product_id', operator: 'set' }],
      order: { 'recharge.revenue_vnd_real': 'desc' as const },
      limit,
    };
    const result = (await load(query, token, 90_000)) as { data: CfmSkuRow[] };
    const rows = (result?.data ?? []).map(
      (r): SkuRow => ({
        productId: String(r['recharge.product_id'] ?? ''),
        productName: String(r['recharge.product_id'] ?? ''),
        revenue: Number(r['recharge.revenue_vnd_real'] ?? 0),
        txnCount: Number(r['recharge.transactions'] ?? 0),
      }),
    );
    return { snapshotAt: new Date().toISOString(), rows, notAvailable: false };
  }

  // jus_vn — filter currency='VND' to avoid mixed USD+VND sum inflation.
  const query = {
    measures: ['recharge.revenue_vnd', 'recharge.transactions'],
    dimensions: ['recharge.product_id', 'recharge.product_name'],
    filters: [
      { member: 'recharge.currency', operator: 'equals', values: ['VND'] },
      { member: 'recharge.product_id', operator: 'set' },
    ],
    order: { 'recharge.revenue_vnd': 'desc' as const },
    limit,
  };
  const result = (await load(query, token, 90_000)) as { data: JusSkuRow[] };
  const rows = (result?.data ?? []).map(
    (r): SkuRow => ({
      productId: String(r['recharge.product_id'] ?? ''),
      productName: String(r['recharge.product_name'] ?? r['recharge.product_id'] ?? ''),
      revenue: Number(r['recharge.revenue_vnd'] ?? 0),
      txnCount: Number(r['recharge.transactions'] ?? 0),
    }),
  );
  return { snapshotAt: new Date().toISOString(), rows, notAvailable: false };
}
