/**
 * Curated decomposition targets for the Delta view.
 *
 * The KPI row mirrors the product vision (DAU · Revenue · Payer rate · D7
 * retention) so the surface communicates *what we want to look at*. But a
 * contribution waterfall is only honest for ADDITIVE measures (sum/count) whose
 * per-segment pieces sum back to the headline swing. Ratios (payer rate, D7
 * retention) and distinct-counts (DAU) are non-additive and have no cube measure
 * that can be decomposed this way — so they ship as DISABLED tabs carrying the
 * reason, rather than faking a number.
 *
 * Revenue is the one fully-wired path: `game_key_metrics.rev` is an additive sum
 * present on every game, carrying the acquisition slices (platform / country /
 * media source / campaign / paid-vs-organic). report_date is the time grain.
 */

export const DELTA_TIME_DIMENSION = 'game_key_metrics.report_date';

export interface DeltaMeasureOption {
  id: string;
  label: string;
  /** Currency-formatted (VND) vs plain integer. */
  unit: 'vnd' | 'count';
  /** False → tab renders disabled; the waterfall can't faithfully represent it. */
  available: boolean;
  /** Why a disabled measure isn't decomposable — shown on hover. */
  unavailableReason?: string;
  /** KPI-strip tile id whose sparkline backs the headline trend (available only). */
  sparkTile?: string;
}

export const DELTA_MEASURES: DeltaMeasureOption[] = [
  {
    id: 'dau',
    label: 'DAU',
    unit: 'count',
    available: false,
    unavailableReason:
      'DAU is a distinct count of active users — non-additive. Segment pieces double-count cross-platform users and don’t sum to the headline, so a contribution waterfall would be misleading. Needs an additive active-users model.',
  },
  {
    id: 'game_key_metrics.rev',
    label: 'Revenue',
    unit: 'vnd',
    available: true,
    sparkTile: 'revenue',
  },
  {
    id: 'payer_rate',
    label: 'Payer rate',
    unit: 'count',
    available: false,
    unavailableReason:
      'Payer rate is a ratio (payers ÷ active) — non-additive. Per-segment contributions don’t sum to the headline; this needs a mix/rate decomposition, not the additive waterfall.',
  },
  {
    id: 'd7_retention',
    label: 'D7 retention',
    unit: 'count',
    available: false,
    unavailableReason:
      'D7 retention is a ratio — non-additive, same as payer rate. The cube holds cohort counts but not a decomposable retention measure.',
  },
];

export interface DeltaDimensionOption {
  id: string;
  label: string;
}

export const DELTA_DIMENSIONS: DeltaDimensionOption[] = [
  { id: 'game_key_metrics.platform', label: 'Platform' },
  { id: 'game_key_metrics.country_code', label: 'Country' },
  { id: 'game_key_metrics.media_source', label: 'Media source' },
  { id: 'game_key_metrics.is_paid_install', label: 'Paid vs organic' },
  { id: 'game_key_metrics.campaign_id', label: 'Campaign' },
];

export type DeltaPeriodPreset = 'wow' | 'mom';

export interface DeltaPeriods {
  periodA: [string, string];
  periodB: [string, string];
  labelA: string;
  labelB: string;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Shift a date by `days` (UTC), returning a new Date. */
function shift(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/**
 * Build the two comparison windows. Anchored to "yesterday" as the latest
 * complete day (today's data is partial). WoW = last 7 complete days vs the 7
 * before; MoM = last 30 vs the prior 30.
 */
export function buildPeriods(preset: DeltaPeriodPreset, today = new Date()): DeltaPeriods {
  const width = preset === 'wow' ? 7 : 30;
  const end = shift(today, -1); // yesterday — last complete day
  const startB = shift(end, -(width - 1));
  const endA = shift(startB, -1);
  const startA = shift(endA, -(width - 1));
  const tag = preset === 'wow' ? 'wk' : '30d';
  return {
    periodA: [iso(startA), iso(endA)],
    periodB: [iso(startB), iso(end)],
    labelA: `Prior ${tag}`,
    labelB: `Current ${tag}`,
  };
}
