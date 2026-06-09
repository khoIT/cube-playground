/**
 * Retention prune for the sweep-run snapshot tables.
 *
 * Membership is the bulky table (≈ cohort size summed over playbooks, per run,
 * 4 runs/day/game) so it ages out fast; the run + per-playbook count rows are
 * cheap and kept far longer for long-range trend. Single runner, daily tick,
 * catch-up on boot. Logs rows removed (never silent truncation) so retention is
 * observable. Mirrors the activity-events prune cron.
 */

import { pruneMembershipBefore, pruneRunsBefore } from '../care/care-sweep-run-store.js';

export const CARE_MEMBERSHIP_RETENTION_DAYS = 30;
export const CARE_RUN_RETENTION_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

/** Run one prune pass. Returns rows removed. `now` injectable for tests. */
export function pruneCareSweepTick(now: number = Date.now()): { membership: number; runs: number } {
  const membershipCutoff = new Date(now - CARE_MEMBERSHIP_RETENTION_DAYS * DAY_MS).toISOString();
  const runsCutoff = new Date(now - CARE_RUN_RETENTION_DAYS * DAY_MS).toISOString();
  // Prune membership first (short horizon), then old runs (long horizon) whose
  // CASCADE clears any results + membership still attached.
  const membership = pruneMembershipBefore(membershipCutoff);
  const runs = pruneRunsBefore(runsCutoff);
  if (membership > 0 || runs > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[care-sweep-prune] removed ${membership} membership row(s) older than ` +
        `${CARE_MEMBERSHIP_RETENTION_DAYS}d, ${runs} run(s) older than ${CARE_RUN_RETENTION_DAYS}d`,
    );
  }
  return { membership, runs };
}

let interval: ReturnType<typeof setInterval> | null = null;

export function startCareSweepPruneCron(): void {
  if (interval) return;
  try {
    pruneCareSweepTick();
  } catch {
    /* best-effort; next tick retries */
  }
  interval = setInterval(() => {
    try {
      pruneCareSweepTick();
    } catch {
      /* best-effort */
    }
  }, TICK_INTERVAL_MS);
}

/** Test-only: stop the timer so a suite doesn't leak an open handle. */
export function __stopCareSweepPruneCron(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
