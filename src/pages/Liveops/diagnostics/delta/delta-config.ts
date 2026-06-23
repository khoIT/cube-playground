/**
 * Curated decomposition targets for the Delta view.
 *
 * All draw from `game_key_metrics` — present on every game, additive (sum), and
 * carrying the acquisition slices (platform / country / media source / campaign /
 * paid-vs-organic). Using one verified all-games cube keeps the picker honest
 * across titles without per-game meta plumbing. report_date is the time grain.
 */

export const DELTA_TIME_DIMENSION = 'game_key_metrics.report_date';

export interface DeltaMeasureOption {
  id: string;
  label: string;
  /** Currency-formatted (VND) vs plain integer. */
  unit: 'vnd' | 'count';
}

export const DELTA_MEASURES: DeltaMeasureOption[] = [
  { id: 'game_key_metrics.rev', label: 'Revenue', unit: 'vnd' },
  { id: 'game_key_metrics.npu', label: 'New payers', unit: 'count' },
  { id: 'game_key_metrics.nru', label: 'New users', unit: 'count' },
  { id: 'game_key_metrics.installs', label: 'Installs', unit: 'count' },
  { id: 'game_key_metrics.cost_vnd', label: 'Ad spend', unit: 'vnd' },
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
