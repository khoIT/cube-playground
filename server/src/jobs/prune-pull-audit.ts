/**
 * Retention prune for the public-pull audit table.
 *
 * Per-page auditing writes one row per page request, so a few large paginated
 * pulls can add thousands of rows fast. This ages rows out on a daily tick (with a
 * catch-up pass on boot) so the table stays bounded. Logs rows removed (never
 * silent truncation) so retention is observable. Mirrors the activity-events /
 * care-sweep prune crons.
 */

import { prunePullAudit } from '../auth/public-pull-audit.js';

export const PULL_AUDIT_RETENTION_DAYS = 90;
const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

/** Run one prune pass. Returns rows removed. */
export function prunePullAuditTick(): number {
  const removed = prunePullAudit(PULL_AUDIT_RETENTION_DAYS);
  if (removed > 0) {
    // eslint-disable-next-line no-console
    console.log(`[pull-audit-prune] removed ${removed} row(s) older than ${PULL_AUDIT_RETENTION_DAYS}d`);
  }
  return removed;
}

let interval: ReturnType<typeof setInterval> | null = null;

export function startPullAuditPruneCron(): void {
  if (interval) return;
  try {
    prunePullAuditTick();
  } catch {
    /* best-effort; next tick retries */
  }
  interval = setInterval(() => {
    try {
      prunePullAuditTick();
    } catch {
      /* best-effort */
    }
  }, TICK_INTERVAL_MS);
}

/** Test-only: stop the timer so a suite doesn't leak an open handle. */
export function __stopPullAuditPruneCron(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
