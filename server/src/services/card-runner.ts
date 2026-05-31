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
import { loadWithContinueWait } from './load-with-continue-wait.js';
import type {
  PresetSpec,
  KpiSpec,
  CardSpec,
} from '../presets/mf-users-hub.js';

/** A Cube filter is either a leaf clause or a boolean group. Predicate-derived
 *  segment queries use both shapes (e.g. `{ or: [...] }`), so the card-runner
 *  must carry them through opaquely when scoping. */
export type CubeFilter =
  | { member: string; operator: string; values?: string[] }
  | { and: CubeFilter[] }
  | { or: CubeFilter[] };

interface CubeQuery {
  measures: string[];
  dimensions?: string[];
  timeDimensions?: Array<{
    dimension: string;
    granularity?: string;
    dateRange?: string;
  }>;
  order?: Record<string, 'asc' | 'desc'>;
  filters?: CubeFilter[];
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

/** AND the segment's predicate filters onto a card query, intersecting the
 *  card's own filters with the cohort definition. Cube ANDs top-level filter
 *  entries, so prepending the card's filters and appending the segment's is a
 *  plain set union of constraints. */
function scopeQuery(q: CubeQuery, segmentFilters: CubeFilter[]): CubeQuery {
  if (segmentFilters.length === 0) return q;
  return { ...q, filters: [...(q.filters ?? []), ...segmentFilters] };
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

/** Walk a preset and emit { cardId, queryHash, rows } per KPI + card.
 *  `segmentFilters` are the segment's predicate filters (from its stored
 *  cube_query_json); each card query is scoped by ANDing them on. */
/** Per-card Cube timeout. Cards lean on heavy pre-aggregations (e.g. the LTV
 *  install-cohort rollup) that can be mid-warm when a refresh fires; poll
 *  through "Continue wait" rather than dropping the card on the first miss. */
const PER_CARD_TIMEOUT_MS = 30_000;

export async function runPresetCards(
  preset: PresetSpec,
  segmentFilters: CubeFilter[],
  tokenOverride?: string,
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
    const scoped = scopeQuery(query, segmentFilters);
    try {
      const raw = await loadWithContinueWait(scoped, tokenOverride, PER_CARD_TIMEOUT_MS);
      results.push({ cardId: id, queryHash: hashQuery(scoped), rows: extractRows(raw) });
    } catch (err) {
      // Card-level failure shouldn't kill the whole refresh — log and skip.
      // The FE will fall back to live fetch for any cardId missing from cache.
      console.warn(`[card-runner] ${id} failed:`, (err as Error).message);
    }
  }
  return results;
}
