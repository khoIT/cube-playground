/**
 * Shared resolution of a segment's COHORT query context, intersected with the
 * "paying users only" sub-scope (lifetime recharge > 0). Two surfaces need the
 * exact same setup to paying-scope on demand at view time:
 *   - the live Members tier recompute (segment-paying-tiers.ts), and
 *   - the Care tab's paying-uid subset (cs-care-builder.ts `payingOnly`).
 *
 * Rather than each re-deriving identity/preset/prefix/meta/rank — and drifting —
 * they both call {@link resolvePayingCohortContext}. It mirrors the refresh
 * job's setup (refresh-segment.ts) but reads the segment's predicate from its
 * STORED cube_query_json (same basis every live card already uses via the FE's
 * predicateFiltersForSegment), so paying-scoped Members/Care agree with the
 * already-shipped paying-scoped KPIs/Insights/Monitor.
 *
 * The paying primitive is the `<hubCube>.paying_lifetime` cube segment, modeled
 * on mf_users across all games — so the sub-scope is offered only when the
 * segment's resolved preset hub is mf_users (matches the FE's `available` gate).
 */

import { loadWithContinueWait } from './load-with-continue-wait.js';
import { resolveIdentityField } from './resolve-identity-field.js';
import { resolveGamePrefixForWorkspace } from './resolve-game-prefix.js';
import { resolveCubeTokenForGame } from './resolve-cube-token.js';
import { logicalCube, physicalizeQuery, physicalMember } from './cube-member-resolver.js';
import { pickPresetForSegment } from '../presets/registry.js';
import { getMetaMemberSets } from './cube-meta-members.js';
import { parseCubeSegments } from './cube-query-segments.js';
import { pickSegmentRankMeasure, type RankFilter } from './segment-rank-measure.js';
import type { SegmentRow } from '../routes/segments.js';

/** The hub cube that models `paying_lifetime`; the only preset the sub-scope is
 *  offered for (matches the FE's mf_users-only `available` gate). */
const PAYING_HUB_CUBE = 'mf_users';
/** Cube segment that scopes a query to lifetime payers. */
const PAYING_SEGMENT = 'paying_lifetime';
/** Shared cohort-query budget — outlast a cold warehouse read. */
const COHORT_TIMEOUT_MS = Number(process.env.MEMBER_TIER_TIMEOUT_MS) || 120_000;

export interface PayingCohortContext {
  /** Identity dimension (logical; physicalized downstream per `prefix`). */
  identityField: string;
  /** Cube-name prefix for prefix-model workspaces; null on game_id workspaces. */
  prefix: string | null;
  /** Per-game Cube JWT for the read, or undefined when AUTH is disabled. */
  token: string | undefined;
  /** Stored predicate filters (already resolved cutoffs) from cube_query_json. */
  segmentFilters: RankFilter[];
  /** Cohort cube-segments AND the paying primitive — scope membership exactly
   *  like the segment does, then narrow to payers. */
  payingCubeSegments: string[];
  /** Measure to rank members by (segment's defining measure, else preset LTV). */
  rankMeasure: string | null;
  /** Per-user name dim, validated against /meta (null when the game omits it). */
  nameDim: string | null;
  /** Exact distinct-count size measure (physical), or null → `total: true`. */
  sizeMeasure: string | null;
}

function parseFilters(cubeQueryJson: unknown): RankFilter[] {
  if (typeof cubeQueryJson !== 'string' || !cubeQueryJson) return [];
  try {
    const q = JSON.parse(cubeQueryJson) as { filters?: unknown };
    return Array.isArray(q.filters) ? (q.filters as RankFilter[]) : [];
  } catch {
    return [];
  }
}

/**
 * Resolve the paying-scoped cohort context for a segment, or null when the
 * sub-scope doesn't apply (no identity, or the resolved preset hub isn't
 * mf_users — same gate as the FE). Never throws on the gate; a genuine Cube
 * failure during identity/meta resolution propagates to the caller.
 */
export async function resolvePayingCohortContext(row: SegmentRow): Promise<PayingCohortContext | null> {
  const cube = typeof row.cube === 'string' ? row.cube : null;
  const gameId = typeof row.game_id === 'string' ? row.game_id : null;
  const workspace = String(row.workspace);
  if (!cube) return null;

  const identityField = await resolveIdentityField(cube, gameId, { workspaceId: workspace });
  if (!identityField) return null;

  const prefix = resolveGamePrefixForWorkspace(workspace, gameId);
  // Match the refresh job's anchor-cube pivot: a join-inherited identity (e.g.
  // an active_daily segment whose identity resolves to mf_users.user_id) takes
  // the identity-anchor cube's preset, so cubes without their own member
  // columns still resolve the mf_users hub.
  const anchorCube = identityField.includes('.') ? identityField.split('.')[0] : null;
  const preset = pickPresetForSegment(
    logicalCube(cube, prefix),
    anchorCube ? logicalCube(anchorCube, prefix) : null,
  );
  // Offered only for the mf_users hub (where paying_lifetime is modeled).
  if (preset?.hubCube !== PAYING_HUB_CUBE) return null;

  const metaSets = await getMetaMemberSets(gameId);
  const token = gameId ? resolveCubeTokenForGame(gameId) ?? undefined : undefined;

  const segmentFilters = parseFilters(row.cube_query_json);
  const cohortCubeSegments = parseCubeSegments(row.cube_query_json as string | null) ?? [];
  // The paying primitive lives on the identity's hub cube; physicalization is
  // handled per-query downstream (physicalizeQuery is idempotent on it).
  const payingSegment = `${identityField.split('.')[0]}.${PAYING_SEGMENT}`;
  const payingCubeSegments = [...new Set([...cohortCubeSegments, payingSegment])];

  const rankMeasure = pickSegmentRankMeasure(
    segmentFilters,
    metaSets,
    prefix,
    preset?.ltvMeasure ?? null,
  );

  // Name dim from the preset's `name` member column, only when /meta confirms
  // the game models it (an unknown member 400s the whole grouped query).
  const nameColumn = (preset?.memberColumns ?? []).find(
    (c): c is { id?: unknown; dimension?: unknown } =>
      !!c && typeof c === 'object' && (c as { id?: unknown }).id === 'name',
  );
  const nameDimRaw = nameColumn && typeof nameColumn.dimension === 'string' ? nameColumn.dimension : null;
  const nameDim =
    nameDimRaw && (!metaSets || metaSets.dimensions.has(physicalMember(nameDimRaw, prefix)))
      ? nameDimRaw
      : null;

  const sizeMeasure =
    preset?.sizeMeasure && metaSets?.measures.has(physicalMember(preset.sizeMeasure, prefix))
      ? physicalMember(preset.sizeMeasure, prefix)
      : null;

  return { identityField, prefix, token, segmentFilters, payingCubeSegments, rankMeasure, nameDim, sizeMeasure };
}

function extractRows(loadResult: unknown): Array<Record<string, unknown>> {
  const r = loadResult as {
    data?: Array<Record<string, unknown>>;
    results?: Array<{ data?: Array<Record<string, unknown>> }>;
  };
  return r.data ?? r.results?.[0]?.data ?? [];
}

/**
 * Count the paying sub-cohort (segment predicate ∩ payers). Prefers the exact
 * distinct-count measure (one COUNT(DISTINCT) pushed to Trino); falls back to
 * `total: true` over the identity projection when no size measure resolves.
 */
export async function countPayingCohort(ctx: PayingCohortContext): Promise<number> {
  const base = {
    filters: ctx.segmentFilters,
    segments: ctx.payingCubeSegments,
  };
  if (ctx.sizeMeasure) {
    const q = physicalizeQuery({ ...base, dimensions: [], measures: [ctx.sizeMeasure], limit: 1 }, ctx.prefix);
    const res = await loadWithContinueWait(q, ctx.token, COHORT_TIMEOUT_MS);
    const row = extractRows(res)[0];
    return Math.round(Number(row?.[q.measures[0]] ?? 0));
  }
  const q = physicalizeQuery({ ...base, dimensions: [ctx.identityField], limit: 1, total: true }, ctx.prefix);
  const res = (await loadWithContinueWait(q, ctx.token, COHORT_TIMEOUT_MS)) as {
    total?: number;
    results?: Array<{ total?: number }>;
  };
  return res.total ?? res.results?.[0]?.total ?? 0;
}

/**
 * Resolve the top `cap` paying uids ranked by the segment's rank measure (or
 * unordered identity projection when no rank measure resolves). One grouped
 * Cube read; the caller caps for downstream IN-list safety.
 */
export async function resolveRankedPayingUids(ctx: PayingCohortContext, cap: number): Promise<string[]> {
  const q = physicalizeQuery(
    {
      dimensions: [ctx.identityField],
      measures: ctx.rankMeasure ? [ctx.rankMeasure] : [],
      filters: ctx.segmentFilters,
      segments: ctx.payingCubeSegments,
      ...(ctx.rankMeasure
        ? { order: { [ctx.rankMeasure]: 'desc' as const, [ctx.identityField]: 'asc' as const } }
        : {}),
      limit: cap,
    },
    ctx.prefix,
  );
  const dimKey = q.dimensions[0];
  const res = await loadWithContinueWait(q, ctx.token, COHORT_TIMEOUT_MS);
  const seen = new Set<string>();
  const uids: string[] = [];
  for (const r of extractRows(res)) {
    const v = r[dimKey];
    if (v == null) continue;
    const key = String(v);
    if (seen.has(key)) continue;
    seen.add(key);
    uids.push(key);
  }
  return uids;
}
