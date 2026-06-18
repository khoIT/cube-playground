/**
 * Observability reader for the nightly lakehouse membership snapshot.
 *
 * Two truth sources, deliberately combined:
 *  - SQLite `segment_snapshot_log` — per-INSTANCE heartbeat (the gateway that
 *    served this request). If the snapshot job runs on another instance (prod),
 *    this list is empty there is no cross-DB view.
 *  - Trino `segment_membership_daily` latest partition — CROSS-instance truth:
 *    whichever instance ran the job, the partition landed in the shared
 *    lakehouse. Cached with a TTL because an admin tab poll must not hammer
 *    cold Trino.
 */

import { getDb } from '../db/sqlite.js';
import {
  lakehouseConnectorFromEnv,
  LAKEHOUSE_SCHEMA,
  SEGMENT_MEMBERSHIP_DAILY,
} from '../lakehouse/lakehouse-trino-connector.js';
import { runQuery } from '../services/trino-rest-client.js';
import { isSnapshotRunning } from '../jobs/snapshot-segment-membership.js';

// Per-statement read timeout, sized to ride out a cold warehouse.
// Env: SEGMENT_SNAPSHOT_READ_TIMEOUT_MS.
const TRINO_READ_TIMEOUT_MS = Number(process.env.SEGMENT_SNAPSHOT_READ_TIMEOUT_MS) || 120_000;
const LATEST_PARTITION_TTL_MS = 10 * 60_000;

export interface SnapshotRunError {
  segmentId: string;
  gameId: string | null;
  detail: string | null;
}

/** One segment's outcome within a snapshot run — the per-segment breakdown an
 *  expanded run row shows. `name`/`owner` resolve from this instance's segments
 *  table (null when the segment was deleted since the run). The snapshot lands
 *  ALL owners' predicate segments, so `owner` is shown for provenance clarity. */
export interface SnapshotRunItem {
  segmentId: string;
  name: string | null;
  owner: string | null;
  gameId: string | null;
  rowCount: number | null;
  status: string; // 'written' | 'skipped' | 'error' | 'started' (mid-run)
  detail: string | null;
}

export interface SnapshotRun {
  snapshotDate: string;
  startedAt: string | null;
  written: number;
  skipped: number;
  errored: number;
  deltaStatus: string | null; // 'written' | 'error' | null (not run)
  deltaRows: number | null;
  definitionsStatus: string | null; // 'written' | 'error' | null (not run)
  definitionsRows: number | null;
  /** Run-level failure that aborted before any segment wrote (e.g. the schema /
   *  tables couldn't be ensured because the lakehouse was unreachable). null on
   *  a healthy run. Without this a doomed run reads as a silent 0/0/0. */
  runError: string | null;
  errors: SnapshotRunError[];
  /** Per-segment outcomes in write order (sentinels excluded). */
  items: SnapshotRunItem[];
}

export interface LatestLandedPartition {
  snapshotDate: string;
  games: Array<{ gameId: string; segments: number; rows: number }>;
}

export interface SnapshotRunsPayload {
  enabledHere: boolean;
  /** A snapshot run (cron or manual) is in flight on THIS gateway right now. */
  runningNow: boolean;
  runs: SnapshotRun[];
  /** Shared-lakehouse truth — null when Trino is unreachable. */
  latestLanded: LatestLandedPartition | null;
  latestLandedError: string | null;
}

interface LogRow {
  snapshot_date: string;
  segment_id: string;
  game_id: string | null;
  row_count: number | null;
  status: string;
  detail: string | null;
  ts: string;
}

const MAX_ERRORS_PER_RUN = 10;

/** Group the per-instance heartbeat log into one row per run (snapshot date). */
export function listSnapshotRuns(limit = 30): SnapshotRun[] {
  const rows = getDb()
    .prepare(
      `SELECT snapshot_date, segment_id, game_id, row_count, status, detail, ts
         FROM segment_snapshot_log
        WHERE snapshot_date IN (
                SELECT DISTINCT snapshot_date FROM segment_snapshot_log
                 ORDER BY snapshot_date DESC LIMIT ?)
        ORDER BY snapshot_date DESC, ts ASC, id ASC`,
    )
    .all(limit) as LogRow[];

  // Segment name + owner resolve from this instance's segments table — one
  // query, applied to every run's items (deleted segments fall back to null).
  const meta = new Map<string, { name: string; owner: string | null }>();
  for (const s of getDb()
    .prepare('SELECT id, name, owner FROM segments')
    .all() as Array<{ id: string; name: string; owner: string | null }>) {
    meta.set(s.id, { name: s.name, owner: s.owner });
  }

  const byDate = new Map<string, SnapshotRun>();
  for (const r of rows) {
    let run = byDate.get(r.snapshot_date);
    if (!run) {
      run = {
        snapshotDate: r.snapshot_date,
        startedAt: null,
        written: 0,
        skipped: 0,
        errored: 0,
        deltaStatus: null,
        deltaRows: null,
        definitionsStatus: null,
        definitionsRows: null,
        runError: null,
        errors: [],
        items: [],
      };
      byDate.set(r.snapshot_date, run);
    }
    // Sentinel rows (double-underscore ids) carry run-level facts, not segment
    // outcomes — keep them out of the written/skipped/errored counts. Matching
    // by prefix tolerates future sentinels (e.g. __definitions__).
    if (r.segment_id.startsWith('__')) {
      if (r.segment_id === '__started__') run.startedAt = r.ts;
      if (r.segment_id === '__delta__') {
        run.deltaStatus = r.status;
        run.deltaRows = r.row_count;
      }
      if (r.segment_id === '__definitions__') {
        run.definitionsStatus = r.status;
        run.definitionsRows = r.row_count;
      }
      // A run-level abort (e.g. schema/tables couldn't be ensured because the
      // lakehouse was unreachable) produces no per-segment rows — surface its
      // detail as a run-level error so the run doesn't read as a silent 0/0/0.
      if (r.segment_id === '__ensure__' && r.status === 'error') run.runError = r.detail;
      continue;
    }
    const m = meta.get(r.segment_id);
    run.items.push({
      segmentId: r.segment_id,
      name: m?.name ?? null,
      owner: m?.owner ?? null,
      gameId: r.game_id,
      rowCount: r.row_count,
      status: r.status,
      detail: r.detail,
    });
    if (r.status === 'written') run.written++;
    else if (r.status === 'skipped') run.skipped++;
    else {
      run.errored++;
      if (run.errors.length < MAX_ERRORS_PER_RUN) {
        run.errors.push({ segmentId: r.segment_id, gameId: r.game_id, detail: r.detail });
      }
    }
  }
  return [...byDate.values()];
}

let latestCache: { at: number; value: LatestLandedPartition | null; error: string | null } | null =
  null;

/**
 * Latest landed partition in the shared lakehouse (TTL-cached). Best-effort:
 * Trino unreachable → { value: null, error } rather than a thrown 500, so the
 * per-instance log still renders.
 */
export async function readLatestLandedPartition(fresh = false): Promise<{
  value: LatestLandedPartition | null;
  error: string | null;
}> {
  // `fresh` bypasses the TTL cache — the admin UI requests it right after a
  // manual snapshot (and on run completion) so the reachability chip + latest
  // partition reflect reality immediately instead of up to a TTL-window later.
  if (!fresh && latestCache && Date.now() - latestCache.at < LATEST_PARTITION_TTL_MS) {
    return { value: latestCache.value, error: latestCache.error };
  }
  try {
    const connector = lakehouseConnectorFromEnv();
    const sql = `SELECT snapshot_date, game_id, count(distinct segment_id) AS segments, count(*) AS rows
      FROM ${SEGMENT_MEMBERSHIP_DAILY}
      WHERE snapshot_date = (SELECT max(snapshot_date) FROM ${SEGMENT_MEMBERSHIP_DAILY})
      GROUP BY 1, 2 ORDER BY 2`;
    const res = await runQuery(connector, LAKEHOUSE_SCHEMA, sql, TRINO_READ_TIMEOUT_MS);
    let value: LatestLandedPartition | null = null;
    for (const row of res.rows) {
      const [date, gameId, segments, rows] = row as [string, string, number, number];
      if (!value) value = { snapshotDate: String(date), games: [] };
      value.games.push({ gameId: String(gameId), segments: Number(segments), rows: Number(rows) });
    }
    latestCache = { at: Date.now(), value, error: null };
  } catch (err) {
    // Cache failures too — a downed Trino shouldn't be re-probed on every poll.
    latestCache = { at: Date.now(), value: null, error: (err as Error).message };
  }
  return { value: latestCache.value, error: latestCache.error };
}

export async function collectSnapshotRuns(fresh = false): Promise<SnapshotRunsPayload> {
  const latest = await readLatestLandedPartition(fresh);
  return {
    enabledHere: (process.env.SEGMENT_SNAPSHOT_ENABLED ?? 'false').toLowerCase() === 'true',
    runningNow: isSnapshotRunning(),
    runs: listSnapshotRuns(),
    latestLanded: latest.value,
    latestLandedError: latest.error,
  };
}
