/**
 * SQLite store for pre-aggregation sweep history.
 *
 * Pure SQL with `db` injection (no getDb() here) — testable against :memory:.
 * Mirrors the metric-drift-run-store pattern: camel↔snake mapping at the
 * boundary, no ORM.
 *
 * upsertSweep is idempotent on started_at: a re-tail or collector restart
 * replaces the existing row + items so the UI always shows the latest data
 * for that sweep window without duplicating it.
 */

import type Database from 'better-sqlite3';
import type {
  PreaggSweep,
  PreaggSweepInput,
  PreaggSweepItem,
  PreaggSweepItemInput,
  RollupBuildStat,
} from '../types/preagg-run.js';

// ---------------------------------------------------------------------------
// Raw DB row shapes (snake_case ↔ camelCase mapping)
// ---------------------------------------------------------------------------

interface RawSweep {
  id: number;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  source: string;
  games_count: number | null;
  rollups_total: number | null;
  sealed_count: number | null;
  stale_count: number | null;
  failed_count: number | null;
  unbuilt_count: number | null;
  collector_status: string | null;
}

interface RawItem {
  id: number;
  sweep_id: number;
  game: string | null;
  cube: string | null;
  rollup: string | null;
  outcome: string;
  serveable: number | null;
  last_sealed_at: string | null;
  error_sig: string | null;
  error_message: string | null;
  observed_at: string | null;
  build_ms: number | null;
  partitions_built: number | null;
  rollups_built: string | null;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function toSweep(r: RawSweep): PreaggSweep {
  return {
    id: r.id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationMs: r.duration_ms,
    source: r.source as PreaggSweep['source'],
    gamesCount: r.games_count ?? 0,
    rollupsTotal: r.rollups_total ?? 0,
    sealedCount: r.sealed_count ?? 0,
    staleCount: r.stale_count ?? 0,
    failedCount: r.failed_count ?? 0,
    unbuiltCount: r.unbuilt_count ?? 0,
    collectorStatus: r.collector_status ?? 'disabled',
  };
}

function toItem(r: RawItem): PreaggSweepItem {
  return {
    id: r.id,
    sweepId: r.sweep_id,
    game: r.game,
    cube: r.cube,
    rollup: r.rollup,
    outcome: r.outcome as PreaggSweepItem['outcome'],
    serveable: !!r.serveable,
    lastSealedAt: r.last_sealed_at,
    errorSig: r.error_sig,
    errorMessage: r.error_message,
    observedAt: r.observed_at ?? new Date().toISOString(),
    buildMs: r.build_ms,
    partitionsBuilt: r.partitions_built,
    rollupsBuilt: parseRollupsBuilt(r.rollups_built),
  };
}

function parseRollupsBuilt(raw: string | null): RollupBuildStat[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((entry): RollupBuildStat =>
      // Legacy rows stored bare rollup-name strings (no per-rollup stats);
      // surface them with zeroed stats rather than dropping the names.
      typeof entry === 'string'
        ? { rollup: entry, partitions: 0, buildMs: 0 }
        : {
            rollup: String((entry as RollupBuildStat).rollup ?? ''),
            partitions: Number((entry as RollupBuildStat).partitions) || 0,
            buildMs: Number((entry as RollupBuildStat).buildMs) || 0,
          },
    );
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upsert a sweep + replace all its items atomically.
 * Idempotent on started_at: a second call for the same window overwrites the
 * prior data so restarts don't produce duplicate rows.
 */
export function upsertSweep(
  db: Database.Database,
  input: PreaggSweepInput,
  items: PreaggSweepItemInput[],
): PreaggSweep {
  return db.transaction(() => {
    // INSERT or UPDATE the sweep header row
    db.prepare(
      `INSERT INTO preagg_sweep
         (started_at, ended_at, duration_ms, source, games_count, rollups_total,
          sealed_count, stale_count, failed_count, unbuilt_count, collector_status)
       VALUES
         (@startedAt, @endedAt, @durationMs, @source, @gamesCount, @rollupsTotal,
          @sealedCount, @staleCount, @failedCount, @unbuiltCount, @collectorStatus)
       ON CONFLICT(started_at) DO UPDATE SET
         ended_at         = excluded.ended_at,
         duration_ms      = excluded.duration_ms,
         source           = excluded.source,
         games_count      = excluded.games_count,
         rollups_total    = excluded.rollups_total,
         sealed_count     = excluded.sealed_count,
         stale_count      = excluded.stale_count,
         failed_count     = excluded.failed_count,
         unbuilt_count    = excluded.unbuilt_count,
         collector_status = excluded.collector_status`,
    ).run(input);

    const row = db
      .prepare(`SELECT * FROM preagg_sweep WHERE started_at = ?`)
      .get(input.startedAt) as RawSweep;

    const sweepId = row.id;

    // Replace items atomically — delete first so a re-tail never doubles items
    db.prepare(`DELETE FROM preagg_sweep_item WHERE sweep_id = ?`).run(sweepId);

    const insertItem = db.prepare(
      `INSERT INTO preagg_sweep_item
         (sweep_id, game, cube, rollup, outcome, serveable,
          last_sealed_at, error_sig, error_message, observed_at,
          build_ms, partitions_built, rollups_built)
       VALUES
         (@sweepId, @game, @cube, @rollup, @outcome, @serveable,
          @lastSealedAt, @errorSig, @errorMessage, @observedAt,
          @buildMs, @partitionsBuilt, @rollupsBuilt)`,
    );

    for (const item of items) {
      insertItem.run({
        ...item,
        sweepId,
        serveable: item.serveable ? 1 : 0,
        buildMs: item.buildMs ?? null,
        partitionsBuilt: item.partitionsBuilt ?? null,
        rollupsBuilt: item.rollupsBuilt ? JSON.stringify(item.rollupsBuilt) : null,
      });
    }

    return toSweep(row);
  })();
}

/** Fetch the single most recent sweep header (by started_at), or null. */
export function getLatestSweep(db: Database.Database): PreaggSweep | null {
  const row = db
    .prepare(`SELECT * FROM preagg_sweep ORDER BY started_at DESC LIMIT 1`)
    .get() as RawSweep | undefined;
  return row ? toSweep(row) : null;
}

/** List the N most recent sweeps (header only, no items). */
export function listSweeps(db: Database.Database, limit = 30): PreaggSweep[] {
  const rows = db
    .prepare(`SELECT * FROM preagg_sweep ORDER BY started_at DESC LIMIT ?`)
    .all(limit) as RawSweep[];
  return rows.map(toSweep);
}

/**
 * Most recent known seal time per (game, cube) across all retained sweeps.
 * Feeds the readiness matrix's "last sealed" ages — the live probe only says
 * built/unbuilt; the seal timestamps live in sweep history.
 */
export function latestSealedByGameCube(
  db: Database.Database,
): Array<{ game: string; cube: string; lastSealedAt: string }> {
  return db
    .prepare(
      `SELECT game, cube, MAX(last_sealed_at) AS last_sealed_at
         FROM preagg_sweep_item
        WHERE last_sealed_at IS NOT NULL AND game IS NOT NULL AND cube IS NOT NULL
        GROUP BY game, cube`,
    )
    .all()
    .map((r) => {
      const row = r as { game: string; cube: string; last_sealed_at: string };
      return { game: row.game, cube: row.cube, lastSealedAt: row.last_sealed_at };
    });
}

/** Fetch a single sweep with all its items. Returns null if not found. */
export function getSweepWithItems(
  db: Database.Database,
  id: number,
): { sweep: PreaggSweep; items: PreaggSweepItem[] } | null {
  const sweepRow = db
    .prepare(`SELECT * FROM preagg_sweep WHERE id = ?`)
    .get(id) as RawSweep | undefined;
  if (!sweepRow) return null;

  const itemRows = db
    .prepare(
      `SELECT * FROM preagg_sweep_item WHERE sweep_id = ?
       ORDER BY
         CASE outcome
           WHEN 'stale_serving' THEN 0
           WHEN 'failed'        THEN 1
           WHEN 'unbuilt'       THEN 2
           ELSE                      3
         END, cube, game`,
    )
    .all(id) as RawItem[];

  return { sweep: toSweep(sweepRow), items: itemRows.map(toItem) };
}

/**
 * Prune sweep rows (+ cascaded items) older than the given ISO cutoff.
 * Called at the end of each collector pass to cap retention at 30 days.
 */
export function pruneOlderThan(db: Database.Database, isoCutoff: string): number {
  const info = db
    .prepare(`DELETE FROM preagg_sweep WHERE started_at < ?`)
    .run(isoCutoff);
  return info.changes;
}
