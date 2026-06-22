/**
 * Cohort profile runner — produces top-k dimension breakdowns for a CANDIDATE
 * predicate (not yet a saved segment) so a producer can answer "who are these
 * people?" before committing.
 *
 * Execution strategy: Cube /load with `group by <dimension>` + `limit k`, one
 * query per dimension. This reuses the exact predicate→Cube-filters path that
 * `compute-segment-size` uses, so the population scoping is identical to what
 * the segment will count after save. The alternative — raw Trino SQL — is
 * skipped here because (a) we don't have a reliable physical-table resolver for
 * every cube from server-side code, and (b) the Cube path already handles
 * workspace/token dispatch, pre-agg warming, and continue-wait polling.
 *
 * Best-effort contract: each dimension query runs independently under
 * Promise.allSettled. A single slow or unavailable dimension is simply omitted
 * from the response; it never fails the whole request. On total-count failure
 * the caller receives { total: null, breakdowns: [], approx: true }.
 */

import type { PredicateNode } from '../types/predicate-tree.js';
import { treeToCubeFilters } from './translator.js';
import { resolveIdentityDetailed } from './resolve-identity-field.js';
import { loadWithContinueWait } from './load-with-continue-wait.js';
import { collectPercentileLeaves, resolveSegmentCutoffs } from './segment-cutoff-resolver.js';
import { resolveCubeTokenForGame } from './resolve-cube-token.js';
import { corePanelsForGame, type PanelColumn } from './member360-panel-registry.js';

/** Per-dimension Cube timeout. Conservative: breakdowns are simple group-bys
 *  that should warm quickly, but a cold warehouse can still take >10s. */
const PER_DIM_TIMEOUT_MS = Number(process.env.COHORT_PROFILE_DIM_TIMEOUT_MS) || 18_000;

/** Maximum number of dimensions to profile — bounds fan-out cost. */
const MAX_DIMS = 4;

/** Top-k values per dimension. */
const TOP_K = 6;

/** Preferred profiling dimensions picked from the profile panel in priority
 *  order. These map to well-maintained dims on `user_profile` that are stable
 *  across all games using the standard `user_profile` view. */
const PREFERRED_DIM_FIELDS = [
  'country',
  'os_platform',
  'payer_tier',
  'lifecycle_stage',
];

export interface DimensionBreakdown {
  dimension: string;
  label: string;
  top: Array<{ value: string; count: number; pct: number }>;
}

export interface CohortProfileResult {
  total: number | null;
  breakdowns: DimensionBreakdown[];
  took_ms: number;
  approx: boolean;
}

/** Injectable seams for unit tests — mirror the pattern in compute-segment-size.ts. */
export interface CohortProfileDeps {
  loadFn?: (query: unknown, token: string | undefined, timeoutMs: number) => Promise<unknown>;
  resolveIdentity?: typeof resolveIdentityDetailed;
  resolveCutoffs?: typeof resolveSegmentCutoffs;
}

export interface CohortProfileOpts {
  game_id: string;
  cube: string;
  predicate: PredicateNode;
  /** Explicit dimension members to profile (e.g. 'user_profile.country').
   *  When absent, defaults are selected from the member-360 profile panel. */
  dimensions?: string[];
}

/**
 * Pick up to MAX_DIMS dimension members from the member-360 profile panel for
 * a game. Returns [] when the game has no profile panel (caller degrades to
 * total-only).
 *
 * Exported so tests can assert the selection logic without running Cube.
 */
export function selectProfileDimensions(gameId: string | null | undefined): string[] {
  const panels = corePanelsForGame(gameId);
  const profilePanel = panels.find((p) => p.id === 'profile');
  if (!profilePanel) return [];

  // Index the profile panel's dimension columns by field name for fast lookup.
  const dimByField = new Map<string, PanelColumn>(
    profilePanel.columns
      .filter((c) => c.kind === 'dimension')
      .map((c) => [c.member.split('.')[1], c]),
  );

  const selected: string[] = [];
  for (const field of PREFERRED_DIM_FIELDS) {
    if (selected.length >= MAX_DIMS) break;
    const col = dimByField.get(field);
    if (col) selected.push(col.member);
  }
  return selected;
}

/**
 * Parse a Cube /load grouped response into top-k rows for a single dimension.
 *
 * Cube grouped response shape: { data: Array<{ [dim]: string; [identityField+"_count"]: string }> }
 * The count measure Cube returns when `total:true` with group-by is the total
 * row count label on the identity dim; we request a count distinct via a
 * special query shape instead (see buildDimQuery).
 *
 * When we do group-by without measures, Cube returns the row count for each
 * group in the `total` field only; with measures we get count per group in the
 * data array. We use `{ measures: [identityField + "_count"] }` which maps to
 * `count()` on the identity dimension if it exists, otherwise fall back to
 * reading the flat data row count.
 */
function parseBreakdownRows(
  rawData: Array<Record<string, unknown>>,
  dimensionMember: string,
): Array<{ value: string; rawCount: number }> {
  // Cube returns member names as-is in the data keys.
  // Count is under any key ending in "_count" or "_COUNT", or we count rows.
  const countKey = Object.keys(rawData[0] ?? {}).find(
    (k) => k !== dimensionMember && (k.endsWith('.count') || k.endsWith('_count')),
  );

  return rawData.map((row) => {
    const value = String(row[dimensionMember] ?? '(unknown)');
    const rawCount = countKey
      ? Number(row[countKey] ?? 0)
      : 1; // fallback: each row = 1 user (unlikely path)
    return { value, rawCount };
  });
}

/**
 * Build a Cube /load query that groups the predicate population by one
 * dimension and counts distinct users.
 *
 * We ask Cube to `group by dim` + `order by identityCount desc` + `limit k`.
 * Using `total: true` gives us the grand total (same as compute-segment-size)
 * in the same trip; however Cube's `total` with dimensions gives the
 * grand-total row count, NOT the distinct-user count per group — so we use the
 * per-group data rows for count values and treat the grand-total separately.
 */
function buildDimQuery(
  identityField: string,
  dimensionMember: string,
  filters: unknown[],
  topK: number,
): Record<string, unknown> {
  // `count` measure on the identity field — Cube auto-creates `<cube>.count`
  // for every cube. We derive it from the identity field's cube prefix.
  const cubeName = identityField.split('.')[0];
  const countMeasure = `${cubeName}.count`;

  return {
    dimensions: [dimensionMember],
    measures: [countMeasure],
    filters,
    order: { [countMeasure]: 'desc' },
    limit: topK,
  };
}

/**
 * Build a Cube /load query that returns only the total user count (same as
 * compute-segment-size), used when we need the grand total for pct calculation
 * without a full group-by.
 */
function buildTotalQuery(
  identityField: string,
  filters: unknown[],
): Record<string, unknown> {
  return {
    dimensions: [identityField],
    total: true,
    limit: 1,
    filters,
  };
}

export async function runCohortProfile(
  opts: CohortProfileOpts,
  deps: CohortProfileDeps = {},
): Promise<CohortProfileResult> {
  const start = Date.now();
  const loadFn = deps.loadFn ?? loadWithContinueWait;
  const resolveIdentity = deps.resolveIdentity ?? resolveIdentityDetailed;
  const resolveCutoffs = deps.resolveCutoffs ?? resolveSegmentCutoffs;

  const elapsed = () => Date.now() - start;

  // Resolve the Cube token for this game (null = open cube).
  const token = resolveCubeTokenForGame(opts.game_id) ?? undefined;

  // --- Identity resolution ------------------------------------------------
  let identityField: string;
  try {
    const identity = await resolveIdentity(opts.cube, opts.game_id, {});
    if (!identity.field) {
      // Cube doesn't know this cube's identity — return graceful empty.
      return { total: null, breakdowns: [], took_ms: elapsed(), approx: true };
    }
    identityField = identity.field;
  } catch {
    return { total: null, breakdowns: [], took_ms: elapsed(), approx: true };
  }

  // --- Predicate → Cube filters -------------------------------------------
  let filters: unknown[];
  try {
    let resolvedPercentiles: Map<string, number> | undefined;
    if (collectPercentileLeaves(opts.predicate).length > 0) {
      resolvedPercentiles = await resolveCutoffs(opts.predicate);
    }
    filters = treeToCubeFilters(
      opts.predicate,
      resolvedPercentiles ? { resolvedPercentiles } : {},
    );
  } catch {
    return { total: null, breakdowns: [], took_ms: elapsed(), approx: true };
  }

  // --- Dimension selection ------------------------------------------------
  const rawDims = opts.dimensions?.length
    ? opts.dimensions
    : selectProfileDimensions(opts.game_id);

  // Cap to MAX_DIMS.
  const dims = rawDims.slice(0, MAX_DIMS);

  // --- Total count (same mechanism as compute-segment-size) ---------------
  let total: number | null = null;
  try {
    const totalQuery = buildTotalQuery(identityField, filters);
    const totalRes = (await loadFn(totalQuery, token, PER_DIM_TIMEOUT_MS)) as {
      total?: number;
      results?: Array<{ total?: number }>;
    };
    total = totalRes.total ?? totalRes.results?.[0]?.total ?? null;
  } catch {
    // Total failure is non-fatal — breakdowns can still be assembled with
    // relative pct (pct = count / sumOfCounts for this dimension).
  }

  // --- Per-dimension breakdowns (best-effort parallel) --------------------
  if (dims.length === 0) {
    return { total, breakdowns: [], took_ms: elapsed(), approx: total === null };
  }

  const settledBreakdowns = await Promise.allSettled(
    dims.map(async (dim): Promise<DimensionBreakdown> => {
      const query = buildDimQuery(identityField, dim, filters, TOP_K);
      const res = (await loadFn(query, token, PER_DIM_TIMEOUT_MS)) as {
        data?: Array<Record<string, unknown>>;
        results?: Array<{ data?: Array<Record<string, unknown>> }>;
      };
      const rawData: Array<Record<string, unknown>> =
        res.data ?? res.results?.[0]?.data ?? [];

      const rows = parseBreakdownRows(rawData, dim);
      const sumCounts = rows.reduce((s, r) => s + r.rawCount, 0);
      // Use grand total for pct when available; otherwise relativize within
      // the top-k slice (will sum ≤ 100% since we only see top-k).
      const denominator = total ?? sumCounts;

      const top = rows.map((r) => ({
        value: r.value,
        count: r.rawCount,
        pct: denominator > 0 ? Math.round((r.rawCount / denominator) * 10000) / 100 : 0,
      }));

      // Extract a human label: last segment after '.' (e.g. 'country' from 'user_profile.country').
      const label = dim.split('.').pop() ?? dim;

      return { dimension: dim, label, top };
    }),
  );

  // Keep only fulfilled dims; omit rejected ones silently.
  const breakdowns = settledBreakdowns
    .filter((r): r is PromiseFulfilledResult<DimensionBreakdown> => r.status === 'fulfilled')
    .map((r) => r.value);

  return {
    total,
    breakdowns,
    took_ms: elapsed(),
    approx: total === null,
  };
}
