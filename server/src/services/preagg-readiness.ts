/**
 * Pre-aggregation readiness probe service.
 *
 * Probes each known pre-agg-bearing cube per game in a `game_id` workspace by
 * issuing a minimal /sql DRY-RUN and classifying by where the COMPILED query
 * routes — cross-checked against what is actually materialised in CubeStore:
 *   built       — compiled SQL routes to a rollup (external:true, FROM preagg_*)
 *                 AND that table has active partitions in CubeStore
 *   from-source — compiled SQL reads the raw source table; no rollup matches the
 *                 query's members/grain (true Trino passthrough)
 *   unbuilt     — a rollup is planned but CubeStore holds no active partitions
 *                 for it (defined-but-not-materialised / registered-not-active)
 *   error       — timeout, auth failure, cube missing, or other unexpected error
 *
 * Why NOT `usedPreAggregations`: every cube in this model exposes its rollup via
 * a `rollup_lambda` (`union_with_source_data: true`), and Cube masks
 * `usedPreAggregations` to EMPTY for lambda unions — the result blends a sealed
 * CubeStore rollup with a live source tail, so Cube won't attribute it to one
 * pre-agg. Asserting that field reads EVERY lambda rollup as passthrough no
 * matter how completely it is built. The compiled-SQL FROM clause is the honest
 * routing signal (see docs/lessons-learned.md → "Cube model").
 *
 * CubeStore verification is gated on `CUBESTORE_INTROSPECT_ENABLED`. When
 * introspection is off (e.g. prod hosts that can't reach :3306), the probe
 * degrades to /sql-only: a planned rollup reads `built` on routing alone (it can
 * no longer prove materialisation), which is still stricter than the old
 * any-200-is-green behaviour.
 *
 * Non-game_id workspaces (prefix, etc.) short-circuit and return an empty
 * section — they point at an external cube stack where these rollups may differ.
 *
 * Concurrency is hard-capped at 2 in-flight probes (mirrors the fan-out incident
 * documented in lessons-learned: dozens of concurrent calls compiling all
 * tenants at once wedged the cube container during a pre-agg warm phase).
 */

import { sqlWithCtx, type WorkspaceCtx } from './cube-client.js';
import { loadGamesConfig } from './games-config-loader.js';
import { resolveCubeTokenForWorkspace } from './resolve-cube-token.js';
import { mapWithConcurrency } from './bounded-concurrency.js';
import { getModelPreaggRegistry } from './preagg-model-registry.js';
import { extractPlannedPreaggs } from './cubestore-query-cache-check.js';
import {
  findPreaggByTableName,
  isCubestoreIntrospectEnabled,
} from './cubestore-introspect.js';
import type { WorkspaceDef } from './workspaces-config-loader.js';

// ---------------------------------------------------------------------------
// Curated pre-agg registry
// ---------------------------------------------------------------------------

/**
 * Cubes that carry rollup pre-aggregations in cube-dev's vendored model.
 * Each entry records one representative measure + the cube's time dimension
 * so the probe can issue a minimal, date-bounded /load.
 *
 * cros and tf are intentionally excluded — none of their model files under
 * cube-dev/cube/model/cubes/<game>/ define a pre_aggregations block, so their
 * queries pass through to Trino and can never hit the unbuilt-partition error.
 *
 * This list mirrors the rollup definitions in cube-dev; update here if a new
 * pre-agg-bearing cube is added to the vendor model.
 */
export interface PreaggRegistryEntry {
  /** Cube name (bare, no game prefix — game_id workspace resolves per-game). */
  cube: string;
  /** One measure served by the rollup — used as the sole query measure. */
  measure: string;
  /** Time dimension the rollup is partitioned on. */
  timeDimension: string;
}

export const PREAGG_REGISTRY: PreaggRegistryEntry[] = [
  {
    cube: 'active_daily',
    measure: 'active_daily.dau',
    timeDimension: 'active_daily.log_date',
  },
  {
    cube: 'game_key_metrics',
    measure: 'game_key_metrics.cost_vnd',
    timeDimension: 'game_key_metrics.report_date',
  },
  {
    cube: 'marketing_cost',
    measure: 'marketing_cost.cost_vnd',
    timeDimension: 'marketing_cost.log_date',
  },
  {
    cube: 'mf_users',
    measure: 'mf_users.user_count_approx',
    timeDimension: 'mf_users.install_date',
  },
  {
    cube: 'user_recharge_daily',
    measure: 'user_recharge_daily.revenue_vnd_total',
    timeDimension: 'user_recharge_daily.log_date',
  },
];

// ---------------------------------------------------------------------------
// Partition-error classifier
// ---------------------------------------------------------------------------

/**
 * Discriminating substring from Cube's partition error. Exported so other
 * cube-error classifiers (e.g. the artifact validation sweep) share one
 * definition instead of re-declaring the string.
 */
export const PARTITION_NOT_BUILT_SUBSTRING =
  'No pre-aggregation partitions were built yet';

/**
 * Returns true when an error message indicates the partition was not yet built.
 * Exported for testing and downstream reuse.
 */
export function isPartitionNotBuiltError(message: string): boolean {
  return message.includes(PARTITION_NOT_BUILT_SUBSTRING);
}

export type ProbeStatus = 'built' | 'from-source' | 'unbuilt' | 'error';

export interface ProbeResult {
  cube: string;
  status: ProbeStatus;
  /** Present when status is 'unbuilt' or 'error'. */
  message?: string;
}

// ---------------------------------------------------------------------------
// Single probe
// ---------------------------------------------------------------------------

/**
 * Build a minimal 1-day probe query for a registry entry.
 * The /sql dry-run is compile-time only (no data scan), so the exact date does
 * not gate routing — the planner matches a rollup structurally on
 * measures/dimensions/grain. Yesterday keeps the range plausible.
 */
function buildProbeQuery(entry: PreaggRegistryEntry): unknown {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const iso = yesterday.toISOString().slice(0, 10); // 'YYYY-MM-DD'
  return {
    measures: [entry.measure],
    timeDimensions: [
      {
        dimension: entry.timeDimension,
        dateRange: [iso, iso],
        granularity: 'day',
      },
    ],
    limit: 1,
  };
}

/**
 * Issue one probe for a single registry entry against the given ctx.
 * Always resolves (never throws) — failures become status:'error'.
 *
 * Uses a /sql dry-run (cheap, compile-only — no cold-Trino scan) to read where
 * the query routes, then verifies materialisation in CubeStore. See file header
 * for why `usedPreAggregations` from /load is NOT usable in this lambda model.
 */
async function probeOne(ctx: WorkspaceCtx, entry: PreaggRegistryEntry): Promise<ProbeResult> {
  try {
    const body = await sqlWithCtx(buildProbeQuery(entry), ctx);
    const planned = extractPlannedPreaggs(body);

    // Compiled SQL reads the raw source — no rollup matches this query's
    // members/grain. True Trino passthrough.
    if (planned.length === 0) {
      return { cube: entry.cube, status: 'from-source' };
    }

    // A rollup is planned. Without CubeStore introspection we can't prove the
    // partitions exist, so trust the routing plan (still stricter than any-200).
    if (!isCubestoreIntrospectEnabled()) {
      return { cube: entry.cube, status: 'built' };
    }

    // Introspection on: green only if a planned rollup table is actually
    // materialised AND active in CubeStore. A plan that points at a
    // defined-but-unmaterialised rollup is `unbuilt`, not green.
    for (const p of planned) {
      const m = await findPreaggByTableName(p.tableName);
      if (m && m.activePartitions > 0 && m.readyCount > 0) {
        return { cube: entry.cube, status: 'built' };
      }
    }
    return {
      cube: entry.cube,
      status: 'unbuilt',
      message: `rollup planned (${planned[0].tableName}) but no active partitions in CubeStore`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isPartitionNotBuiltError(msg)) {
      return { cube: entry.cube, status: 'unbuilt', message: msg };
    }
    return { cube: entry.cube, status: 'error', message: msg };
  }
}

// ---------------------------------------------------------------------------
// Per-game probe aggregation
// ---------------------------------------------------------------------------

export interface GamePreaggResult {
  id: string;
  label: string;
  cubes: ProbeResult[];
  built: number;
  /** 200 but served from Trino — rollup defined, not materialised/active. */
  fromSource: number;
  unbuilt: number;
  errored: number;
}

export interface PreaggReadiness {
  games: GamePreaggResult[];
  /** ISO timestamp when this result was computed. */
  generatedAt: string;
  /** Present when workspace is not game_id — probe is not applicable. */
  note?: string;
}

// ---------------------------------------------------------------------------
// TTL cache (mirrors gamesReadinessCache in workspace-readiness.ts)
// ---------------------------------------------------------------------------

interface CacheEntry {
  at: number;
  result: PreaggReadiness;
}

const preaggCache = new Map<string, CacheEntry>();
const PREAGG_CACHE_TTL_MS = 60_000;

/** Workspaces with a background refresh currently in flight (dedup guard). */
const refreshInFlight = new Set<string>();

/** Reset the module-level cache — used in tests to prevent cross-test bleed. */
export function __resetPreaggCache(): void {
  preaggCache.clear();
  refreshInFlight.clear();
}

/**
 * Non-blocking accessor for the readiness probe.
 *
 * The live probe fans out a /sql dry-run per (game, cube) plus a cached
 * CubeStore read — fast, but still enough work that we don't block an HTTP
 * handler on it (a dev proxy in front can error out → 500). This returns cached
 * immediately (even past TTL) and kicks off a single background refresh when
 * the cache is missing or stale. On the very first call, when nothing is
 * cached yet, it returns null so the caller can render a calm "warming" state
 * instead of hanging or 500ing.
 */
export function getPreaggReadinessNonBlocking(
  workspace: WorkspaceDef,
): PreaggReadiness | null {
  const cached = preaggCache.get(workspace.id);
  const fresh = cached && Date.now() - cached.at < PREAGG_CACHE_TTL_MS;
  if (!fresh && !refreshInFlight.has(workspace.id)) {
    refreshInFlight.add(workspace.id);
    computePreaggReadiness(workspace)
      .catch(() => undefined)
      .finally(() => refreshInFlight.delete(workspace.id));
  }
  return cached ? cached.result : null;
}

// ---------------------------------------------------------------------------
// Build ctx for a game (same pattern as workspace-readiness.ts buildCtxFor)
// ---------------------------------------------------------------------------

function buildCtxFor(workspace: WorkspaceDef, gameId: string): WorkspaceCtx {
  const { token } = resolveCubeTokenForWorkspace(workspace, gameId);
  return { cubeApiUrl: workspace.cubeApiUrl, token };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Probe each pre-agg-bearing cube for every game in the workspace.
 *
 * Only applies to `game_id` workspaces — prefix workspaces point at an external
 * cube stack and return an empty section without issuing any /load calls.
 *
 * Bounded at 2 in-flight probes via mapWithConcurrency (fan-out guard).
 * Results are cached for 60s per workspace to avoid re-probing on every poll.
 */
export async function computePreaggReadiness(
  workspace: WorkspaceDef,
): Promise<PreaggReadiness> {
  // Cache hit — return without any /load calls.
  const cached = preaggCache.get(workspace.id);
  if (cached && Date.now() - cached.at < PREAGG_CACHE_TTL_MS) {
    return cached.result;
  }

  // Non-game_id workspaces: pre-agg probing is not applicable.
  if (workspace.gameModel !== 'game_id') {
    const result: PreaggReadiness = {
      games: [],
      generatedAt: new Date().toISOString(),
      note: 'n/a — only game_id workspaces carry in-stack pre-aggregations',
    };
    preaggCache.set(workspace.id, { at: Date.now(), result });
    return result;
  }

  const cfg = loadGamesConfig();

  // Each task = one (game, cube) pair. We flatten into a task list, run with
  // bounded concurrency 2, then re-group by game.
  // Registry per game comes from the in-repo Cube model when available (so the
  // matrix matches each game's REAL rollup-bearing cubes — ptg has recharge +
  // ordered_funnel_canonical, not the standard five); the curated static list
  // is the fallback for hosts that don't ship cube-dev.
  type ProbeTask = { gameId: string; gameLabel: string; entry: PreaggRegistryEntry };
  const tasks: ProbeTask[] = cfg.games.flatMap((g) => {
    const registry = getModelPreaggRegistry(g.id) ?? PREAGG_REGISTRY;
    return registry.map((entry) => ({ gameId: g.id, gameLabel: g.name, entry }));
  });

  const probeResults = await mapWithConcurrency(tasks, 2, async (task) => {
    const ctx = buildCtxFor(workspace, task.gameId);
    const probe = await probeOne(ctx, task.entry);
    return { gameId: task.gameId, gameLabel: task.gameLabel, probe };
  });

  // Re-group by game, preserving original game order.
  const byGame = new Map<string, { label: string; cubes: ProbeResult[] }>();
  for (const g of cfg.games) {
    byGame.set(g.id, { label: g.name, cubes: [] });
  }
  for (const r of probeResults) {
    byGame.get(r.gameId)?.cubes.push(r.probe);
  }

  const games: GamePreaggResult[] = cfg.games.map((g) => {
    const entry = byGame.get(g.id)!;
    const built = entry.cubes.filter((c) => c.status === 'built').length;
    const fromSource = entry.cubes.filter((c) => c.status === 'from-source').length;
    const unbuilt = entry.cubes.filter((c) => c.status === 'unbuilt').length;
    const errored = entry.cubes.filter((c) => c.status === 'error').length;
    return { id: g.id, label: g.name, cubes: entry.cubes, built, fromSource, unbuilt, errored };
  });

  const result: PreaggReadiness = { games, generatedAt: new Date().toISOString() };
  preaggCache.set(workspace.id, { at: Date.now(), result });
  return result;
}
