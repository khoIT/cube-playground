/**
 * Pure merge function: combines a serveability probe with rollup-level log
 * failures to produce the outcome taxonomy for one sweep.
 *
 * Outcome rules (per game × cube):
 *   probe=built  + no log error → sealed         (healthy, serving warm)
 *   probe=built  + log error    → stale_serving  (KEY: old cache still up)
 *   probe∈{unbuilt,error} + log error → failed   (not serving at all)
 *   probe=unbuilt/error + no error   → unbuilt   (cold / never built)
 *
 * IMPORTANT: worker logs carry no game/securityContext, so failures are
 * rollup-level. A failure for rollup X is attributed to EVERY game whose probe
 * shows that cube — this over-warns across games sharing a cube. That is the
 * SAFE direction (false-positive stale_serving > false-negative sealed). The UI
 * surfaces this limitation as a disclaimer note.
 *
 * The cube name is extracted from preAggregationId as the token before the
 * first dot, e.g. "active_daily.dau_by_ingame_dims_daily_batch" → "active_daily".
 * A secondary match on tableName (contains the cube token) is also tried so
 * slightly different ID formats still match.
 */

import type { PreaggReadiness } from './preagg-readiness.js';
import type {
  ParsedBuild,
  ParsedFailure,
  PreaggSweepInput,
  PreaggSweepItemInput,
  Outcome,
  SweepSource,
} from '../types/preagg-run.js';

interface SweepMeta {
  source: SweepSource;
  startedAt: string;
  endedAt: string;
  collectorStatus: string;
}

interface MergeResult {
  sweep: PreaggSweepInput;
  items: PreaggSweepItemInput[];
}

// ---------------------------------------------------------------------------
// Failure index: cube name → latest failure in this sweep window
// ---------------------------------------------------------------------------

/**
 * Extract the cube name from a preAggregationId.
 * Format: "<cubeName>.<rollupName>" — everything before the first dot.
 * Returns empty string if the id is empty or has no dot.
 */
function cubeFromPreaggId(id: string): string {
  const dot = id.indexOf('.');
  return dot > 0 ? id.slice(0, dot) : id;
}

/**
 * Check whether a tableName string contains a cube name token.
 * Cube table names include the cube name as a segment separated by underscores
 * or the cube name appears as a prefix, e.g.
 * "prod_pre_aggregations.active_daily_dau_..._batch20260101" contains "active_daily".
 */
function tableNameMatchesCube(tableName: string, cubeName: string): boolean {
  if (!tableName || !cubeName) return false;
  return tableName.toLowerCase().includes(cubeName.toLowerCase());
}

/** Build a map from cube name → most-recent ParsedFailure in the window. */
function buildFailureIndex(failures: ParsedFailure[]): Map<string, ParsedFailure> {
  const index = new Map<string, ParsedFailure>();

  for (const f of failures) {
    const cube = cubeFromPreaggId(f.preAggregationId);

    // Primary match: cube name from preAggregationId prefix
    if (cube) {
      // Keep the latest failure per cube (failures are ordered by ts ascending)
      index.set(cube, f);
      continue;
    }

    // Fallback: try to match against tableName if id had no dot
    if (f.tableName) {
      for (const [existingCube] of index) {
        if (tableNameMatchesCube(f.tableName, existingCube)) {
          index.set(existingCube, f);
        }
      }
    }
  }

  return index;
}

// ---------------------------------------------------------------------------
// Outcome classifier
// ---------------------------------------------------------------------------

function classifyOutcome(probeStatus: 'built' | 'unbuilt' | 'error', hasFailure: boolean): Outcome {
  if (probeStatus === 'built') {
    return hasFailure ? 'stale_serving' : 'sealed';
  }
  // unbuilt or error
  return hasFailure ? 'failed' : 'unbuilt';
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Merge a serveability probe with rollup-level failures to produce a full
 * sweep record ready for DB insertion.
 *
 * sweepId is NOT set here (assigned after DB upsert). Pass items directly to
 * upsertSweep which injects the real sweepId.
 */
/** Aggregated build stats for one game × cube within a sweep. */
interface BuildStats {
  buildMs: number;
  partitions: number;
  /** Per-rollup partitions + duration, so slow rollups are attributable. */
  rollups: Map<string, { partitions: number; buildMs: number }>;
}

/**
 * Index parsed builds by (probe game id, cube). Build lines carry the SCHEMA
 * short name (`preagg_cfm` → 'cfm'), while probe games use full ids
 * ('cfm_vn') — match exact id first, then `<short>_…` prefix.
 */
function buildBuildIndex(
  builds: ParsedBuild[],
  gameIds: string[],
): Map<string, BuildStats> {
  const idForSchema = new Map<string, string | null>();
  const resolve = (schemaGame: string): string | null => {
    if (!idForSchema.has(schemaGame)) {
      idForSchema.set(
        schemaGame,
        gameIds.find((id) => id === schemaGame)
          ?? gameIds.find((id) => id.startsWith(`${schemaGame}_`))
          ?? null,
      );
    }
    return idForSchema.get(schemaGame) ?? null;
  };

  const index = new Map<string, BuildStats>();
  for (const b of builds) {
    const gameId = resolve(b.schemaGame);
    if (!gameId) continue;
    const key = `${gameId}|${b.cube}`;
    let stats = index.get(key);
    if (!stats) {
      stats = { buildMs: 0, partitions: 0, rollups: new Map() };
      index.set(key, stats);
    }
    stats.buildMs += b.durationMs;
    stats.partitions += 1;
    if (b.rollup) {
      const r = stats.rollups.get(b.rollup) ?? { partitions: 0, buildMs: 0 };
      r.partitions += 1;
      r.buildMs += b.durationMs;
      stats.rollups.set(b.rollup, r);
    }
  }
  return index;
}

export function mergeSweep(
  probe: PreaggReadiness,
  failures: ParsedFailure[],
  meta: SweepMeta,
  builds: ParsedBuild[] = [],
): MergeResult {
  const now = meta.endedAt;
  const failureIndex = buildFailureIndex(failures);
  const buildIndex = buildBuildIndex(builds, probe.games.map((g) => g.id));

  const items: PreaggSweepItemInput[] = [];

  for (const game of probe.games) {
    for (const cubeResult of game.cubes) {
      const cubeName = cubeResult.cube;
      const failure = failureIndex.get(cubeName);
      const outcome = classifyOutcome(cubeResult.status, !!failure);
      const serveable = cubeResult.status === 'built';

      // Rollup name from the first failure that matches (best-effort; may be '')
      const rollup = failure ? failure.preAggregationId.slice(cubeName.length + 1) : null;
      const stats = buildIndex.get(`${game.id}|${cubeName}`) ?? null;

      items.push({
        sweepId: 0, // placeholder — upsertSweep replaces with real id
        game: game.id,
        cube: cubeName,
        rollup: rollup || null,
        outcome,
        serveable,
        // Exact per-partition seal times aren't in info-level logs, but a
        // 'sealed' outcome means the rollup was refreshed within THIS sweep —
        // the sweep's observation time is the seal time to sweep precision.
        // Feeds latestSealedByGameCube → the matrix's "sealed Xh ago" cells.
        lastSealedAt: outcome === 'sealed' ? now : null,
        errorSig: failure?.errorSig ?? null,
        errorMessage: failure?.errorMessage ?? null,
        observedAt: now,
        // Attached regardless of outcome — a stale/failed cube may still have
        // completed some partitions before the failure.
        buildMs: stats ? stats.buildMs : null,
        partitionsBuilt: stats ? stats.partitions : null,
        // Slowest rollup first — the one an operator debugging a long sweep
        // wants to see at the top.
        rollupsBuilt: stats && stats.rollups.size > 0
          ? [...stats.rollups.entries()]
              .map(([rollup, r]) => ({ rollup, partitions: r.partitions, buildMs: r.buildMs }))
              .sort((a, b) => b.buildMs - a.buildMs)
          : null,
      });
    }
  }

  // Aggregate counts across all (game × cube) items
  let sealedCount = 0;
  let staleCount = 0;
  let failedCount = 0;
  let unbuiltCount = 0;
  for (const item of items) {
    if (item.outcome === 'sealed') sealedCount++;
    else if (item.outcome === 'stale_serving') staleCount++;
    else if (item.outcome === 'failed') failedCount++;
    else unbuiltCount++;
  }

  // Count unique games that have at least one cube in the probe
  const gamesWithCubes = probe.games.filter((g) => g.cubes.length > 0).length;
  // Total (game × cube) pairs = rollupsTotal for the sweep view
  const rollupsTotal = items.length;

  const durationMs = (() => {
    try {
      return new Date(meta.endedAt).getTime() - new Date(meta.startedAt).getTime();
    } catch {
      return null;
    }
  })();

  const sweep: PreaggSweepInput = {
    startedAt: meta.startedAt,
    endedAt: meta.endedAt,
    durationMs,
    source: meta.source,
    gamesCount: gamesWithCubes,
    rollupsTotal,
    sealedCount,
    staleCount,
    failedCount,
    unbuiltCount,
    collectorStatus: meta.collectorStatus,
  };

  return { sweep, items };
}
