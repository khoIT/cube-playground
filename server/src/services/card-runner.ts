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
import { mapWithConcurrency } from './bounded-concurrency.js';
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
  /** Cube-level segments from the cohort definition (e.g. mf_users.whales). */
  segments?: string[];
  limit?: number;
}

/** Optional live-progress sink. The runner reports its card plan and each
 *  card's start/settle as the pass executes, so a monitor can show a live
 *  checklist while the batched cache upsert is still pending. All methods are
 *  optional — a runner with no reporter behaves exactly as before. */
export interface CardProgressReporter {
  /** Full ordered card-id list, emitted once before any load starts. */
  plan?(cardIds: string[]): void;
  /** A card's Cube load is starting. */
  start?(cardId: string): void;
  /** A card finished — 'ok' on success, 'error' on failure or budget skip. */
  settle?(cardId: string, status: 'ok' | 'error'): void;
}

export interface CardCacheEntry {
  cardId: string;
  queryHash: string;
  rows: Array<Record<string, unknown>>;
  /** 'ok' when the card's Cube load succeeded; 'error' when it failed or was
   *  skipped because the refresh budget ran out. Error entries persist (with
   *  empty rows + a message) so the FE can show "couldn't refresh" instead of a
   *  silent gap that's indistinguishable from "never ran". */
  status: 'ok' | 'error';
  /** Failure reason for status='error' (Cube error or budget message), truncated. */
  error?: string;
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
function scopeQuery(
  q: CubeQuery,
  segmentFilters: CardFilter[],
  cubeSegments: string[] = [],
): CubeQuery {
  // Cube-level segments scope independently of plain filters — attach them
  // even when the predicate carries no filter leaves.
  if (cubeSegments.length > 0) {
    q = { ...q, segments: [...(q.segments ?? []), ...cubeSegments] };
  }
  if (segmentFilters.length === 0) return q;
  // When the predicate already pins a date range on the very time dimension a
  // trend card rolls over, drop the card's own rolling window (`last 30
  // days`) and let the predicate range bound the trend. Otherwise a
  // historical cohort (April matches) intersects the rolling window to an
  // empty chart by construction. Top-level leaf filters only — the builder
  // stores predicate date bounds as flat AND members.
  let timeDimensions = q.timeDimensions;
  if (timeDimensions && timeDimensions.length > 0) {
    const datePinned = new Set(
      segmentFilters
        .filter((f): f is { member: string; operator: string; values?: string[] } => 'member' in f)
        .filter((f) => f.operator === 'inDateRange')
        .map((f) => f.member),
    );
    if (datePinned.size > 0) {
      timeDimensions = timeDimensions.map((td) =>
        datePinned.has(td.dimension) ? { ...td, dateRange: undefined } : td,
      );
    }
  }
  return { ...q, timeDimensions, filters: [...(q.filters ?? []), ...segmentFilters] };
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
 *  through "Continue wait" rather than dropping the card on the first miss.
 *  Env-tunable (`SEGMENT_CARD_TIMEOUT_MS`) for cold local Cube where heavy
 *  full-cohort group-bys over large cohorts need more than the default. */
const PER_CARD_TIMEOUT_MS = Number(process.env.SEGMENT_CARD_TIMEOUT_MS) || 30_000;

/** Max cards loaded concurrently. A preset is ~30 independent Cube loads; a
 *  small fixed pool turns ~30 serial round-trips into a handful of waves while
 *  staying gentle on a warming cluster (unbounded fan-out could stampede a cold
 *  rollup). Mirrors the FE's per-tab concurrency cap. */
const CARD_CONCURRENCY = 4;

/** Wall-clock ceiling for the whole card pass. The per-card timeout bounds one
 *  card, not the phase: a stuck rollup could otherwise let N cards each burn
 *  their own budget. Once this elapses, not-yet-started cards short-circuit to
 *  an error entry instead of waiting — so one warming pre-agg can't stall a
 *  refresh indefinitely.
 *
 *  Must be wide enough that the LAST wave still gets a full per-card timeout —
 *  with ~30 cards at concurrency 4 (~8 waves) a 90s budget squeezed late-wave
 *  heavy cards (retention/composition group-bys) down to ~10s, timing them out
 *  even though they'd complete in 20–30s. Sized to ⌈N/conc⌉ full per-card slots
 *  so card ORDER never decides which cards get starved. Env-tunable. */
const CARD_PHASE_BUDGET_MS =
  Number(process.env.SEGMENT_CARD_PHASE_BUDGET_MS) || 240_000;

/** Cube error messages can be long; cap what we persist per card. */
const MAX_ERROR_LEN = 500;

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
  /**
   * Cube-level segments from the segment's stored query (e.g. mf_users.whales).
   * Scopes every card the same way the size query is scoped — without them a
   * segment-scoped cohort's cards report the unsegmented population.
   */
  cubeSegments: string[] = [],
  /** Optional live-progress sink (see CardProgressReporter). */
  reporter?: CardProgressReporter,
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

  // Announce the full card plan up front so a live monitor can seed every card
  // as 'queued' before the first load fires.
  reporter?.plan?.(allSpecs.map((s) => s.id));

  // Shared wall-clock deadline across the whole pass. Each card's effective
  // timeout is clamped to whatever budget remains, and cards that start after
  // the budget is spent short-circuit without issuing a Cube load.
  const deadline = Date.now() + CARD_PHASE_BUDGET_MS;

  async function runOne({ id, query }: { id: string; query: CubeQuery }): Promise<CardCacheEntry> {
    reporter?.start?.(id);
    const scoped = scopeQuery(query, segmentFilters, cubeSegments);
    // Physicalize the logical preset members for prefix workspaces (idempotent:
    // already-physical predicate filters pass through), then logicalize response
    // row keys so the cached rows match the logical card spec the FE renders by.
    const physical = physicalizeQuery(scoped, prefix);
    const queryHash = hashQuery(physical);

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reporter?.settle?.(id, 'error');
      return {
        cardId: id,
        queryHash,
        rows: [],
        status: 'error',
        error: 'skipped — refresh budget exceeded',
      };
    }

    try {
      const timeout = Math.min(PER_CARD_TIMEOUT_MS, remaining);
      const raw = await loadWithContinueWait(physical, tokenOverride, timeout);
      const rows = logicalizeRows(extractRows(raw), prefix);
      reporter?.settle?.(id, 'ok');
      return { cardId: id, queryHash, rows, status: 'ok' };
    } catch (err) {
      // Card-level failure shouldn't kill the whole refresh — persist an error
      // entry (so the FE shows "couldn't refresh · live data" rather than a
      // silent gap) and let siblings continue.
      const message = (err as Error).message?.slice(0, MAX_ERROR_LEN) ?? 'unknown error';
      console.warn(`[card-runner] ${id} failed:`, message);
      reporter?.settle?.(id, 'error');
      return { cardId: id, queryHash, rows: [], status: 'error', error: message };
    }
  }

  // Order-independent: results are keyed by cardId downstream.
  return mapWithConcurrency(allSpecs, CARD_CONCURRENCY, runOne);
}
