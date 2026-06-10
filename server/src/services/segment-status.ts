/** Atomic status-transition helper for segments. */

import { getDb } from '../db/sqlite.js';
import type { SegmentStatus } from '../types/segment.js';

export function setSegmentStatus(
  id: string,
  status: SegmentStatus,
  brokenReason: string | null,
): void {
  const db = getDb();
  db.prepare(`
    UPDATE segments
       SET status = ?, broken_reason = ?, updated_at = ?
     WHERE id = ?
  `).run(status, brokenReason, new Date().toISOString(), id);
}

/**
 * Reset segments wedged in 'refreshing' back to 'stale'. The refresh queue is
 * in-memory (refresh-queue.ts), so nothing can still be in-flight across a
 * process restart — any row left 'refreshing' at boot is an orphan from a
 * gateway that died mid-refresh. listDueSegments() deliberately skips
 * 'refreshing' rows, so without this reset the orphan is invisible to the cron
 * forever and the segment's cohort + KPI cards stop updating. 'stale' is the
 * same terminal state a transient refresh failure lands on, so the next cron
 * tick re-evaluates it against its cadence and re-enqueues it. Returns the
 * number of rows reset (0 in the common clean-boot case). broken_reason is left
 * untouched — an orphaned in-flight refresh carries none.
 */
export function reconcileOrphanedRefreshing(): number {
  const db = getDb();
  const res = db
    .prepare(`UPDATE segments SET status = 'stale', updated_at = ? WHERE status = 'refreshing'`)
    .run(new Date().toISOString());
  return res.changes;
}

/**
 * Single-id form of reconcileOrphanedRefreshing(): reset one segment from
 * 'refreshing' back to 'stale'. Used by the manual "Unstick" operator action
 * and the wedge watchdog, which both need to recover a specific wedged segment
 * without touching the others. Only flips a row that is actually 'refreshing'
 * (a no-op otherwise), so it is safe to call speculatively. broken_reason is
 * left untouched. Returns true when a row was changed.
 */
export function reconcileSegmentRefreshing(id: string): boolean {
  const db = getDb();
  const res = db
    .prepare(`UPDATE segments SET status = 'stale', updated_at = ? WHERE id = ? AND status = 'refreshing'`)
    .run(new Date().toISOString(), id);
  return res.changes > 0;
}

export function setSegmentUids(
  id: string,
  uids: string[],
  status: SegmentStatus = 'fresh',
): void {
  setSegmentSizeAndUids(id, uids.length, uids, status);
}

/**
 * Persist a segment refresh with an explicit cohort size that may differ from
 * the materialized uid list length. Used when the uid list is paginated /
 * capped for storage but the true cohort size came from a separate aggregate
 * query (`total: true`) — so `uid_count` reflects the real total even when
 * `uid_list_json` is a partial sample.
 */
export function setSegmentSizeAndUids(
  id: string,
  totalCount: number,
  uids: string[],
  status: SegmentStatus = 'fresh',
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE segments
       SET uid_list_json = ?,
           uid_count = ?,
           last_refreshed_at = ?,
           status = ?,
           broken_reason = NULL,
           updated_at = ?
     WHERE id = ?
  `).run(JSON.stringify(uids), totalCount, now, status, now, id);
}
