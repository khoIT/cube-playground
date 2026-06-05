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
import { physicalizeQuery, logicalizeRows } from './cube-member-resolver.js';
import type {
  PresetSpec,
  KpiSpec,
  CardSpec,
} from '../presets/mf-users-hub.js';

// A card filter is either a leaf or a nested and/or group — predicate filters
// carried from the segment can be logical groups, so the type admits both
// shapes and is carried through opaquely when scoping.
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
 * Scope a card query to the segment's predicate filters — its defining slice
 * (e.g. `os_platform = iOS`, `recharge_date in [W20]`). Without these a measure
 * like `revenue_vnd` would re-aggregate over each user's ENTIRE history, so card
 * numbers would diverge from the query-builder cell the segment came from.
 *
 * Scope by the predicate, NOT by inlining the materialized uid list: a
 * million-member cohort serializes to multi-MB of identity-IN values that Cube
 * rejects (query text length > 1,000,000). The predicate is also the only
 * correct basis for ratio/average measures (ARPU, paying-rate), which can't be
 * re-merged across uid batches. Only predicate segments reach here (the refresh
 * job skips manual ones), so an empty predicate means all-users — the correct
 * unscoped result.
 */
function scopeQuery(q: CubeQuery, segmentFilters: CardFilter[]): CubeQuery {
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

/** Per-card Cube timeout. Cards lean on heavy pre-aggregations (e.g. the LTV
 *  install-cohort rollup) that can be mid-warm when a refresh fires; poll
 *  through "Continue wait" rather than dropping the card on the first miss. */
const PER_CARD_TIMEOUT_MS = 30_000;

/** Walk a preset and emit { cardId, queryHash, rows } per KPI + card.
 *  `segmentFilters` are the segment's predicate filters (from its stored
 *  cube_query_json); each card query is scoped by ANDing them on. */
export async function runPresetCards(
  preset: PresetSpec,
  segmentFilters: CardFilter[],
  tokenOverride?: string,
  /**
   * Cube cube-name prefix for prefix-model (prod) workspaces. Preset card specs
   * are written in logical names (`mf_users.user_count`); on a prefix workspace
   * they must be physicalized (`ballistar_mf_users.user_count`) before /load and
   * the response logicalized so card consumers read by the logical spec name.
   * Null on game_id workspaces → no-op.
   */
  prefix: string | null = null,
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
    // Physicalize the logical preset members for prefix workspaces (idempotent:
    // already-physical predicate filters pass through), then logicalize response
    // row keys so the cached rows match the logical card spec the FE renders by.
    const physical = physicalizeQuery(scoped, prefix);
    try {
      const raw = await loadWithContinueWait(physical, tokenOverride, PER_CARD_TIMEOUT_MS);
      const rows = logicalizeRows(extractRows(raw), prefix);
      results.push({ cardId: id, queryHash: hashQuery(physical), rows });
    } catch (err) {
      // Card-level failure shouldn't kill the whole refresh — log and skip.
      // The FE will fall back to live fetch for any cardId missing from cache.
      console.warn(`[card-runner] ${id} failed:`, (err as Error).message);
    }
  }
  return results;
}
