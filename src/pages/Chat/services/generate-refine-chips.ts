/**
 * Generate context-aware "refine this query" chips from a query artifact's own
 * CubeQuery shape. Each chip is a natural-language instruction the agent re-runs
 * with the prior query as merge context (via session memory) — so the chips need
 * only express the intent, not a new query object.
 *
 * Chips are derived from what's actually changeable, never offering a no-op:
 *   - grain: the two time grains the query is NOT already at;
 *   - range: a 30/90-day window when not already that relative range;
 *   - roll-up: drop the current breakdown when the query has a dimension;
 *   - payers: limit to paying users when no payer-ish filter is present.
 * Dimension breakdowns ("by country") are left to the free-text input, since the
 * valid dimensions for a game aren't knowable from the query shape alone.
 */

export interface RefineChip {
  id: string;
  /** Full natural-language instruction sent to the agent on click. */
  text: string;
  /** Terse label for narrow surfaces (e.g. the docked panel); `text` is the tooltip. */
  shortText: string;
}

interface CubeQueryish {
  measures?: unknown;
  dimensions?: unknown;
  filters?: Array<{ member?: string; dimension?: string }>;
  timeDimensions?: Array<{ dimension?: string; granularity?: string; dateRange?: unknown }>;
}

const GRAIN_LABEL: Record<string, string> = { day: 'daily', week: 'weekly', month: 'monthly' };
const GRAIN_SHORT: Record<string, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly' };

function asQuery(query: unknown): CubeQueryish | null {
  return query && typeof query === 'object' ? (query as CubeQueryish) : null;
}

function shortName(member: string): string {
  const tail = member.includes('.') ? member.slice(member.indexOf('.') + 1) : member;
  return tail.replace(/_/g, ' ');
}

export function generateRefineChips(query: unknown): RefineChip[] {
  const q = asQuery(query);
  if (!q) return [];
  const chips: RefineChip[] = [];

  const td = Array.isArray(q.timeDimensions) ? q.timeDimensions[0] : undefined;
  const currentGrain = td?.granularity;
  if (td) {
    for (const g of ['day', 'week', 'month']) {
      if (g !== currentGrain) chips.push({ id: `grain-${g}`, text: `Show this ${GRAIN_LABEL[g]} instead`, shortText: GRAIN_SHORT[g] });
    }
  }

  // Range presets — skip the one already active (relative dateRange string like "last 30 days").
  const rangeStr = typeof td?.dateRange === 'string' ? (td.dateRange as string).toLowerCase() : '';
  for (const days of [30, 90]) {
    if (!rangeStr.includes(`${days} day`)) {
      chips.push({ id: `range-${days}`, text: `Limit to the last ${days} days`, shortText: `Last ${days} days` });
    }
  }

  const dims = Array.isArray(q.dimensions) ? (q.dimensions as string[]) : [];
  if (dims.length > 0) {
    chips.push({ id: 'rollup', text: `Roll this up — remove the ${shortName(dims[dims.length - 1])} breakdown`, shortText: `Roll up ${shortName(dims[dims.length - 1])}` });
  }

  const filters = Array.isArray(q.filters) ? q.filters : [];
  const hasPayerFilter = filters.some((f) => /payer|user_type|ltv|spend|recharge/i.test(f.member ?? f.dimension ?? ''));
  if (!hasPayerFilter) {
    chips.push({ id: 'payers', text: 'Limit to paying users only', shortText: 'Payers only' });
  }

  // Keep the row compact — the free-text input covers anything beyond these.
  return chips.slice(0, 5);
}
