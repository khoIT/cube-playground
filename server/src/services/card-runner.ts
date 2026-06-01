/**
 * Server-side card-runner. For a refreshed segment, composes a Cube query
 * per preset KPI / card spec, executes against /load, and returns the
 * normalised rows ready for the FE to render synchronously.
 *
 * Queries are scoped by ANDing the segment's predicate filters onto each card
 * query — the same filters that produce the segment's authoritative size. This
 * keeps card numbers consistent with the displayed cohort size and avoids
 * inlining the materialized uid list, which can balloon a single query past
 * Cube's query-text length limit for large cohorts (millions of uids → MBs of
 * JSON → HTTP 400). It is also the only correct approach for ratio/average
 * measures (ARPU, paying-rate), which cannot be re-merged across uid batches.
 */

import { createHash } from 'node:crypto';
import { load } from './cube-client.js';
import type {
  PresetSpec,
  KpiSpec,
  CardSpec,
} from '../presets/mf-users-hub.js';

// A card filter is either a leaf or a nested and/or group — slice filters
// carried from the segment predicate can be logical groups, so the type must
// admit both shapes.
type CardFilter =
  | { member: string; operator: string; values?: string[] }
  | { and: CardFilter[] }
  | { or: CardFilter[] };

interface CubeQuery {
  measures: string[];
  dimensions?: string[];
  timeDimensions?: Array<{
    dimension: string;
    granularity?: string;
    dateRange?: string;
  }>;
  order?: Record<string, 'asc' | 'desc'>;
  filters?: CardFilter[];
  limit?: number;
}

export interface CardCacheEntry {
  cardId: string;
  queryHash: string;
  rows: Array<Record<string, unknown>>;
}

function queryForKpi(spec: KpiSpec): CubeQuery {
  const q: CubeQuery = { measures: [spec.measure] };
  if (spec.timeDimension && spec.dateRange) {
    q.timeDimensions = [{ dimension: spec.timeDimension, dateRange: spec.dateRange }];
  }
  return q;
}

function queryForCard(spec: CardSpec): CubeQuery {
  if (spec.kind === 'line') {
    return {
      measures: [spec.measure],
      timeDimensions: [
        {
          dimension: spec.timeDimension,
          granularity: spec.granularity ?? 'day',
          dateRange: spec.dateRange ?? 'last 14 days',
        },
      ],
    };
  }
  // bar + composition share the same query shape
  return {
    measures: [spec.measure],
    dimensions: [spec.groupBy],
    order: { [spec.measure]: 'desc' },
    limit: spec.limit ?? 6,
  };
}

/**
 * Scope a card query to the segment.
 *
 * Two layers, both ANDed onto the card's own filters:
 *   1. The segment's predicate filters (the slice) — e.g. `os_platform = iOS`
 *      and `recharge_date in [W20]`. Without these, a measure like
 *      `revenue_vnd` re-aggregates over each user's ENTIRE history (all
 *      platforms, all time), so the monitor diverges from the query-builder
 *      cell the segment was created from. Applying them makes card numbers
 *      reflect the slice.
 *   2. The materialized uid list — pins membership to the frozen cohort.
 *
 * Both can be present at once: the intersection (uids ∩ slice) equals the
 * cohort, and the slice constraints are what give measures the right window.
 */
function scopeQuery(
  q: CubeQuery,
  identityDim: string,
  uids: string[],
  sliceFilters: CardFilter[],
): CubeQuery {
  const extra: CardFilter[] = [...sliceFilters];
  if (uids.length > 0) {
    extra.push({ member: identityDim, operator: 'equals', values: uids });
  }
  if (extra.length === 0) return q;
  return { ...q, filters: [...(q.filters ?? []), ...extra] };
}

function hashQuery(q: CubeQuery): string {
  return createHash('sha256').update(JSON.stringify(q)).digest('hex').slice(0, 16);
}

function extractRows(loadResult: unknown): Array<Record<string, unknown>> {
  const r = loadResult as {
    data?: Array<Record<string, unknown>>;
    results?: Array<{ data?: Array<Record<string, unknown>> }>;
  };
  return r.data ?? r.results?.[0]?.data ?? [];
}

/** Walk a preset and emit { cardId, queryHash, rows } per KPI + card. */
export async function runPresetCards(
  preset: PresetSpec,
  uids: string[],
  tokenOverride?: string,
  sliceFilters: CardFilter[] = [],
): Promise<CardCacheEntry[]> {
  const allSpecs: Array<{ id: string; query: CubeQuery }> = [];

  for (const kpi of preset.headlineKpis) {
    allSpecs.push({ id: `kpi:${kpi.id}`, query: queryForKpi(kpi) });
  }
  for (const tab of preset.tabs) {
    for (const kpi of tab.kpis) {
      allSpecs.push({ id: `kpi:${tab.id}:${kpi.id}`, query: queryForKpi(kpi) });
    }
    for (const card of tab.cards) {
      allSpecs.push({ id: `card:${tab.id}:${card.id}`, query: queryForCard(card) });
    }
  }

  const results: CardCacheEntry[] = [];
  for (const { id, query } of allSpecs) {
    const scoped = scopeQuery(query, preset.identityDim, uids, sliceFilters);
    try {
      const raw = await load(scoped, tokenOverride);
      results.push({ cardId: id, queryHash: hashQuery(scoped), rows: extractRows(raw) });
    } catch (err) {
      // Card-level failure shouldn't kill the whole refresh — log and skip.
      // The FE will fall back to live fetch for any cardId missing from cache.
      console.warn(`[card-runner] ${id} failed:`, (err as Error).message);
    }
  }
  return results;
}
