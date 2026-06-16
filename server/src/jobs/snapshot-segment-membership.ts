/**
 * Nightly job: land every predicate segment's FULL daily membership in the
 * lakehouse (stag_iceberg.khoitn.segment_membership_daily), then derive the
 * day-over-day delta. Decouples cohort COMPUTE (once/day in Trino) from SERVE
 * (many reads via the Cube rollup), and exposes the full cohort + change feed
 * to downstream consumers — unlike refresh-segment, which keeps only a capped
 * uid sample in SQLite.
 *
 * Safety: the job is wired at bootstrap but only EXECUTES when
 * SEGMENT_SNAPSHOT_ENABLED=true. Cross-catalog INSERTs write to a SHARED Trino
 * lakehouse, so it must be opt-in per environment rather than firing from every
 * dev machine. Runs at most once per GMT+7 calendar day (heartbeat-guarded): a
 * 'started' sentinel row is written before any Trino work so a concurrent tick
 * (or a restart mid-run) short-circuits via alreadyRanToday.
 *
 * Multi-instance: enable on EXACTLY ONE server instance. The daily guard is the
 * SQLite heartbeat — instances with separate DBs won't see each other's
 * sentinel, so env discipline (single enabled instance) is what prevents two
 * full-cohort scans against shared Trino.
 */

import { getDb } from '../db/sqlite.js';
import {
  writeSegmentSnapshot,
  type SegmentSnapshotInput,
} from '../lakehouse/segment-snapshot-writer.js';
import { writeSegmentMembershipDelta } from '../lakehouse/segment-delta-writer.js';
import {
  writeSegmentDefinitions,
  type SegmentDefinitionSnapshotInput,
} from '../lakehouse/segment-definition-writer.js';
import {
  lakehouseSchemaForGame,
  lakehouseConnectorFromEnv,
  ensureLakehouseTables,
} from '../lakehouse/lakehouse-trino-connector.js';

const TICK_INTERVAL_MS = 3_600_000; // hourly; daily-guarded inside the tick
const TZ_OFFSET_MS = 7 * 3_600_000; // GMT+7 (Asia/Saigon) — the ops timezone

/**
 * Cron only attempts the daily run during waking hours [08:00, 24:00) GMT+7 —
 * the window the operator's laptop is likely open. Outside it the hourly tick
 * is a no-op; the daily guard still ensures at most one run per GMT+7 date once
 * inside the window. Manual trigger bypasses this (explicit human action).
 */
const WINDOW_START_HOUR = 8;
const WINDOW_END_HOUR = 24;

/** Current calendar date in GMT+7 as 'YYYY-MM-DD'. */
export function gmt7DateString(nowMs: number = Date.now()): string {
  return new Date(nowMs + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** Hour-of-day (0–23) in GMT+7. */
export function gmt7Hour(nowMs: number = Date.now()): number {
  return new Date(nowMs + TZ_OFFSET_MS).getUTCHours();
}

/** True when `nowMs` falls in the cron's GMT+7 attempt window [08:00, 24:00). */
export function isWithinSnapshotWindow(nowMs: number = Date.now()): boolean {
  const h = gmt7Hour(nowMs);
  return h >= WINDOW_START_HOUR && h < WINDOW_END_HOUR;
}

function isEnabled(): boolean {
  return (process.env.SEGMENT_SNAPSHOT_ENABLED ?? 'false').toLowerCase() === 'true';
}

interface SegmentRow {
  id: string;
  cube: string | null;
  game_id: string | null;
  workspace: string;
  cube_query_json: string | null;
  name: string;
  type: string;
  predicate_tree_json: string | null;
}

/** Eligible segment with the definition fields the definition writer needs on
 *  top of what the membership writer consumes. */
export type SnapshotEligibleSegment = SegmentSnapshotInput & SegmentDefinitionSnapshotInput;

/** Predicate segments eligible for snapshotting: have a cube, a query, a game
 *  id, and that game maps to a known Trino schema. */
export function listSnapshotEligibleSegments(): SnapshotEligibleSegment[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, cube, game_id, workspace, cube_query_json, name, type, predicate_tree_json
         FROM segments
        WHERE type = 'predicate' AND cube IS NOT NULL AND cube_query_json IS NOT NULL
              AND game_id IS NOT NULL`,
    )
    .all() as SegmentRow[];
  const out: SnapshotEligibleSegment[] = [];
  for (const r of rows) {
    if (!r.cube || !r.game_id || !r.cube_query_json) continue;
    if (!lakehouseSchemaForGame(r.game_id)) continue; // unknown game → skip
    out.push({
      segmentId: r.id,
      gameId: r.game_id,
      cube: r.cube,
      workspace: r.workspace,
      cubeQueryJson: r.cube_query_json,
      name: r.name,
      type: r.type,
      predicateTreeJson: r.predicate_tree_json,
    });
  }
  return out;
}

function logHeartbeat(
  snapshotDate: string,
  segmentId: string,
  gameId: string | null,
  rowCount: number | undefined,
  status: string,
  detail: string | undefined,
): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO segment_snapshot_log
           (snapshot_date, segment_id, game_id, row_count, status, detail)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(snapshotDate, segmentId, gameId, rowCount ?? null, status, detail ?? null);
  } catch (err) {
    console.warn(`[snapshot-segment-membership] heartbeat write failed:`, (err as Error).message);
  }
}

export interface SnapshotRunSummary {
  snapshotDate: string;
  total: number;
  written: number;
  skipped: number;
  errored: number;
  deltaStatus: string;
}

/**
 * Snapshot all eligible segments for `snapshotDate` serially (cross-catalog
 * INSERTs are heavy — no parallelism), then compute the day's delta once.
 */
export async function runSegmentMembershipSnapshot(
  snapshotDate: string = gmt7DateString(),
): Promise<SnapshotRunSummary> {
  const segments = listSnapshotEligibleSegments();
  const summary: SnapshotRunSummary = {
    snapshotDate,
    total: segments.length,
    written: 0,
    skipped: 0,
    errored: 0,
    deltaStatus: 'not-run',
  };

  // Sentinel BEFORE any Trino work so a concurrent tick / restart sees this
  // date as already-running and skips (closes the alreadyRanToday race).
  logHeartbeat(snapshotDate, '__started__', null, undefined, 'started', undefined);

  // Build the lakehouse connector once (parses cube-dev/.env) and reuse it for
  // every segment + the delta, rather than re-reading the file per segment.
  const connector = lakehouseConnectorFromEnv();

  // Create the env-scoped schema + tables before any writer runs. On a fresh
  // environment (a newly-pointed schema's first run) nothing has created them
  // yet, so every INSERT would fail with "Table does not exist". Idempotent
  // (CREATE … IF NOT EXISTS) — a cheap no-op once they exist. If it fails (e.g.
  // lakehouse genuinely unreachable) abort before hammering Trino with N
  // doomed INSERTs; a manual re-run clears today's heartbeat and retries.
  try {
    await ensureLakehouseTables(connector);
  } catch (err) {
    const detail = (err as Error).message;
    logHeartbeat(snapshotDate, '__ensure__', null, undefined, 'error', detail);
    console.warn(`[snapshot-segment-membership] ensure tables failed:`, detail);
    summary.deltaStatus = 'skipped-ensure-failed';
    return summary;
  }

  // Definitions land BEFORE the membership loop so a segment whose membership
  // INSERT errors still gets its definition row (history of what was
  // attempted). Failure here never aborts the run — writer doesn't throw.
  const defs = await writeSegmentDefinitions(segments, snapshotDate, { connector });
  logHeartbeat(snapshotDate, '__definitions__', null, defs.rowCount, defs.status, defs.error);

  for (const seg of segments) {
    const res = await writeSegmentSnapshot(seg, snapshotDate, { connector });
    if (res.status === 'written') summary.written++;
    else if (res.status === 'skipped') summary.skipped++;
    else summary.errored++;
    logHeartbeat(
      snapshotDate,
      seg.segmentId,
      seg.gameId,
      res.rowCount,
      res.status,
      res.reason ?? res.error,
    );
  }

  // Derive the delta once for the date — only meaningful if ≥1 segment landed.
  if (summary.written > 0) {
    const delta = await writeSegmentMembershipDelta(snapshotDate, { connector });
    summary.deltaStatus = delta.status;
    logHeartbeat(snapshotDate, '__delta__', null, delta.rowCount, delta.status, delta.error);
  }

  console.log(
    `[snapshot-segment-membership] ${snapshotDate}: ${summary.written} written, ` +
      `${summary.skipped} skipped, ${summary.errored} errored, delta=${summary.deltaStatus}`,
  );
  return summary;
}

/** True when this GMT+7 date already has any snapshot heartbeat (idempotent
 *  across restarts — avoids re-hammering Trino on every hourly tick). */
function alreadyRanToday(snapshotDate: string): boolean {
  try {
    const row = getDb()
      .prepare(`SELECT 1 FROM segment_snapshot_log WHERE snapshot_date = ? LIMIT 1`)
      .get(snapshotDate);
    return row != null;
  } catch {
    return false;
  }
}

let running = false;

/** Whether a snapshot run (cron or manual) is in flight on this gateway. */
export function isSnapshotRunning(): boolean {
  return running;
}

/**
 * Operator-triggered snapshot for today's GMT+7 date, fire-and-forget.
 * Deliberately bypasses BOTH guards the cron tick honours:
 *  - isEnabled: the whole point is running it on a gateway where the nightly
 *    job is off ("job off on this gateway") — an explicit human action.
 *  - alreadyRanToday: writers are idempotent per (date, game, segment)
 *    (DELETE → INSERT), so a re-run refreshes today's partition in place.
 * Today's heartbeat rows are cleared first so the re-run's tallies REPLACE the
 * prior attempt's — listSnapshotRuns aggregates per date; appending would
 * double-count written/skipped. Only the in-flight guard is kept.
 */
export function triggerManualSnapshot(nowMs: number = Date.now()): { started: boolean; reason?: string } {
  if (running) return { started: false, reason: 'snapshot already running' };
  const date = gmt7DateString(nowMs);
  running = true;
  try {
    getDb().prepare('DELETE FROM segment_snapshot_log WHERE snapshot_date = ?').run(date);
  } catch {
    // heartbeat cleanup is best-effort — a duplicate-counted date beats no run
  }
  void runSegmentMembershipSnapshot(date)
    .catch((err) => {
      console.warn('[snapshot-segment-membership] manual run failed:', (err as Error).message);
    })
    .finally(() => {
      running = false;
    });
  return { started: true };
}

export async function snapshotSegmentMembershipTick(nowMs: number = Date.now()): Promise<void> {
  if (!isEnabled() || running) return;
  // Only attempt during waking hours — outside [08:00, 24:00) GMT+7 the tick is
  // a no-op (laptop likely asleep; a 03:00 run isn't wanted).
  if (!isWithinSnapshotWindow(nowMs)) return;
  const date = gmt7DateString(nowMs);
  if (alreadyRanToday(date)) return;
  running = true;
  try {
    await runSegmentMembershipSnapshot(date);
  } catch (err) {
    console.warn(`[snapshot-segment-membership] tick failed:`, (err as Error).message);
  } finally {
    running = false;
  }
}

let interval: ReturnType<typeof setInterval> | null = null;

export function startSegmentMembershipSnapshotCron(): void {
  if (interval) return;
  void snapshotSegmentMembershipTick().catch(() => {});
  interval = setInterval(() => {
    void snapshotSegmentMembershipTick().catch(() => {});
  }, TICK_INTERVAL_MS);
}

export function stopSegmentMembershipSnapshotCron(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
