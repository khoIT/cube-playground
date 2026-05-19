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
  `).run(JSON.stringify(uids), uids.length, now, status, now, id);
}
