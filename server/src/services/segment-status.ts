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
