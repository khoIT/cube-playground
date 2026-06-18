/**
 * Periodic job: land every predicate segment's membership in the lakehouse
 * (stag_iceberg.khoitn.segment_membership_daily), then derive the per-snapshot
 * delta and member-state snapshots.
 *
 * Base tick is 15 minutes. Each tick checks which segments are DUE by comparing
 * the current cadence bucket against the segment's last-snapshotted bucket — so
 * a daily segment fires at most once per GMT+7 day regardless of how many 15m
 * ticks pass. Only segments whose cadence bucket has elapsed actually run Trino
 * work; all others are a cheap SQLite lookup.
 *
 * Safety: the job executes only when SEGMENT_SNAPSHOT_ENABLED=true. Cross-catalog
 * INSERTs write to a SHARED Trino lakehouse, so it must be opt-in per environment
 * rather than firing from every dev machine. An in-flight guard prevents
 * overlapping runs; a per-(segment, snapshot_ts) heartbeat prevents double-writes
 * within the same bucket across restarts.
 *
 * Multi-instance: enable on EXACTLY ONE server instance. The in-flight guard
 * lives in this process — instances with separate DBs won't see each other's
 * sentinel, so env discipline (single enabled instance) prevents stampede.
 */

import { getDb } from '../db/sqlite.js';
import {
  writeSegmentSnapshot,
  type SegmentSnapshotInput,
} from '../lakehouse/segment-snapshot-writer.js';
import { writeSegmentMembershipDeltaForSegment } from '../lakehouse/segment-delta-writer.js';
import {
  writeSegmentDefinitions,
  type SegmentDefinitionSnapshotInput,
} from '../lakehouse/segment-definition-writer.js';
import {
  lakehouseSchemaForGame,
  lakehouseConnectorFromEnv,
  ensureLakehouseTables,
} from '../lakehouse/lakehouse-trino-connector.js';
import {
  type SnapshotCadence,
  coerceCadence,
  cadenceElapsed,
  floorToCadenceBucket,
  snapshotDateOf,
} from '../services/snapshot-cadence.js';
import { writeMemberStateSnapshot } from '../lakehouse/segment-member-state-writer.js';
import { writeSegmentKpiSnapshot } from '../lakehouse/segment-kpi-writer.js';

/** Base tick interval — 15 minutes. Each tick is a cheap elapsed-check per segment;
 *  actual Trino work only runs for segments whose cadence bucket has elapsed. */
const TICK_INTERVAL_MS = 900_000;
const TZ_OFFSET_MS = 7 * 3_600_000; // GMT+7 (Asia/Saigon)

/**
 * Cron only attempts snapshot runs during waking hours [08:00, 24:00) GMT+7.
 * Outside this window the 15m tick is a no-op; the per-(segment, snapshot_ts)
 * guard still prevents double-writes inside the window. Manual trigger bypasses
 * this entirely (explicit human action).
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
  snapshot_cadence: string | null;
}

/** Eligible segment with the definition fields the definition writer needs on
 *  top of what the membership writer consumes. Carries resolved cadence. */
export type SnapshotEligibleSegment = SegmentSnapshotInput &
  SegmentDefinitionSnapshotInput & {
    snapshotCadence: SnapshotCadence;
  };

/** Predicate segments eligible for snapshotting: have a cube, a query, a game
 *  id, and that game maps to a known Trino schema. Carries snapshot_cadence. */
export function listSnapshotEligibleSegments(): SnapshotEligibleSegment[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, cube, game_id, workspace, cube_query_json, name, type,
              predicate_tree_json, snapshot_cadence
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
      snapshotCadence: coerceCadence(r.snapshot_cadence),
    });
  }
  return out;
}

/**
 * True when a heartbeat row already exists for (segmentId, snapshotTs) — the
 * per-bucket idempotence guard. Prevents the same bucket being written twice
 * if the job is restarted mid-run or two overlapping ticks fire (the in-flight
 * guard handles the latter, but defence in depth is cheap here).
 */
function alreadySnapshotted(segmentId: string, snapshotTs: string): boolean {
  try {
    const row = getDb()
      .prepare(
        `SELECT 1 FROM segment_snapshot_log
          WHERE segment_id = ? AND snapshot_ts = ? LIMIT 1`,
      )
      .get(segmentId, snapshotTs);
    return row != null;
  } catch {
    return false;
  }
}

function logHeartbeat(
  snapshotDate: string,
  segmentId: string,
  gameId: string | null,
  rowCount: number | undefined,
  status: string,
  detail: string | undefined,
  snapshotTs?: string,
): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO segment_snapshot_log
           (snapshot_date, segment_id, game_id, row_count, status, detail, snapshot_ts)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(snapshotDate, segmentId, gameId, rowCount ?? null, status, detail ?? null, snapshotTs ?? null);
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
 * Snapshot all eligible due segments for a given nowMs, each at its own
 * snapshot_ts bucket. Idempotent per (segment, snapshot_ts): forced=true
 * bypasses the cadence-elapsed check and the per-bucket guard (manual trigger).
 *
 * Returns a summary keyed to the most common snapshotDate in the run (the
 * calendar date for the majority of segments — used by callers + listSnapshotRuns).
 */
export async function runSegmentMembershipSnapshot(
  snapshotDateHint: string = gmt7DateString(),
  nowMs: number = Date.now(),
  forced = false,
): Promise<SnapshotRunSummary> {
  const segments = listSnapshotEligibleSegments();
  const summary: SnapshotRunSummary = {
    snapshotDate: snapshotDateHint,
    total: segments.length,
    written: 0,
    skipped: 0,
    errored: 0,
    deltaStatus: 'not-run',
  };

  // Run-level sentinel BEFORE any Trino work. A concurrent tick or a restart
  // sees this and short-circuits via alreadySnapshotted per segment.
  logHeartbeat(snapshotDateHint, '__started__', null, undefined, 'started', undefined);

  // Build the lakehouse connector once and reuse it for every segment — avoids
  // re-parsing the cube-dev/.env on every segment in the loop.
  const connector = lakehouseConnectorFromEnv();

  // Ensure schema + tables before any writer runs. If this fails, abort and
  // let the next tick retry — hammering N doomed INSERTs is wasteful.
  try {
    await ensureLakehouseTables(connector);
  } catch (err) {
    const detail = (err as Error).message;
    logHeartbeat(snapshotDateHint, '__ensure__', null, undefined, 'error', detail);
    console.warn(`[snapshot-segment-membership] ensure tables failed:`, detail);
    summary.deltaStatus = 'skipped-ensure-failed';
    return summary;
  }

  // Per-(game, snapshotTs) compiled mf_users SELECT cache — state writer
  // compiles this once per game/ts and reuses across the game's segments.
  const stateSelectCache = new Map<string, string>();

  for (const seg of segments) {
    const snapshotTs = floorToCadenceBucket(nowMs, seg.snapshotCadence);
    const snapshotDate = snapshotDateOf(snapshotTs);

    // Per-segment cadence guard: skip if this bucket was already written —
    // handles restarts and manual/cron overlap. Forced runs bypass this.
    if (!forced && alreadySnapshotted(seg.segmentId, snapshotTs)) {
      summary.skipped++;
      continue;
    }

    // For non-forced ticks, skip segments whose cadence bucket hasn't elapsed.
    // We check this AFTER the alreadySnapshotted guard to avoid a DB read on
    // segments that already fired this tick.
    if (!forced) {
      // Retrieve the last logged snapshot_ts for this segment to pass to cadenceElapsed.
      let lastTs: string | null = null;
      try {
        const row = getDb()
          .prepare(
            `SELECT snapshot_ts FROM segment_snapshot_log
              WHERE segment_id = ? AND snapshot_ts IS NOT NULL
              ORDER BY snapshot_ts DESC LIMIT 1`,
          )
          .get(seg.segmentId) as { snapshot_ts: string } | undefined;
        lastTs = row?.snapshot_ts ?? null;
      } catch {
        lastTs = null;
      }
      if (!cadenceElapsed(lastTs, nowMs, seg.snapshotCadence)) {
        summary.skipped++;
        continue;
      }
    }

    // Definition row lands BEFORE membership: a segment whose membership INSERT
    // errors still gets its definition row (history of what was attempted).
    await writeSegmentDefinitions([seg], snapshotDate, {
      connector,
      snapshotTs,
      snapshotCadence: seg.snapshotCadence,
    });

    // Membership snapshot for this (segment, snapshot_ts).
    const res = await writeSegmentSnapshot(seg, snapshotDate, {
      connector,
      snapshotTs,
    });

    logHeartbeat(
      snapshotDate,
      seg.segmentId,
      seg.gameId,
      res.rowCount,
      res.status,
      res.reason ?? res.error,
      snapshotTs,
    );

    if (res.status === 'written') {
      summary.written++;
      const memberCount = res.rowCount ?? 0;

      // Delta vs the segment's previous snapshot_ts (per-segment, handles gaps
      // and cadence changes correctly — no fixed D-1 assumption).
      const deltaRes = await writeSegmentMembershipDeltaForSegment(
        seg.gameId,
        seg.segmentId,
        snapshotDate,
        snapshotTs,
        { connector },
      );
      logHeartbeat(
        snapshotDate,
        `__delta__:${seg.segmentId}`,
        seg.gameId,
        deltaRes.rowCount,
        deltaRes.status,
        deltaRes.error,
        snapshotTs,
      );

      // Per-user state snapshot: compile mf_users projection once per
      // (game, snapshotTs) and reuse across that game's segments.
      const stateCacheKey = `${seg.gameId}:${snapshotTs}`;
      const stateRes = await writeMemberStateSnapshot(
        seg,
        snapshotTs,
        stateSelectCache,
        stateCacheKey,
        { connector },
      );
      logHeartbeat(
        snapshotDate,
        `__state__:${seg.segmentId}`,
        seg.gameId,
        stateRes.rowCount,
        stateRes.status,
        stateRes.reason ?? stateRes.error,
        snapshotTs,
      );

      // Segment-level KPI time-series: Cube reads scoped to this segment's
      // predicate, persisted as scalar rows keyed by (snapshot_ts, metric).
      const kpiRes = await writeSegmentKpiSnapshot(seg, snapshotTs, memberCount, {
        connector,
      });
      logHeartbeat(
        snapshotDate,
        `__kpi__:${seg.segmentId}`,
        seg.gameId,
        kpiRes.rowCount,
        kpiRes.status,
        kpiRes.reason ?? kpiRes.error,
        snapshotTs,
      );

      summary.deltaStatus = 'written';
    } else if (res.status === 'skipped') {
      summary.skipped++;
    } else {
      summary.errored++;
    }
  }

  console.log(
    `[snapshot-segment-membership] ${snapshotDateHint}: ${summary.written} written, ` +
      `${summary.skipped} skipped, ${summary.errored} errored`,
  );
  return summary;
}

let running = false;

/** Whether a snapshot run (cron or manual) is in flight on this gateway. */
export function isSnapshotRunning(): boolean {
  return running;
}

/**
 * Operator-triggered snapshot: forces ALL eligible segments to snapshot at
 * their current cadence bucket RIGHT NOW, bypassing the window guard, the
 * cadence-elapsed check, and the per-bucket idempotence guard. The in-flight
 * guard is kept (a second manual trigger while one runs short-circuits).
 *
 * Clears today's heartbeat rows first so listSnapshotRuns aggregates this
 * run's tallies cleanly instead of appending to the prior attempt's.
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
  void runSegmentMembershipSnapshot(date, nowMs, true)
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
  // Only attempt during waking hours — outside [08:00, 24:00) GMT+7 the tick
  // is a no-op (laptop likely asleep; early-morning runs aren't wanted).
  if (!isWithinSnapshotWindow(nowMs)) return;
  const date = gmt7DateString(nowMs);
  running = true;
  try {
    await runSegmentMembershipSnapshot(date, nowMs, false);
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
