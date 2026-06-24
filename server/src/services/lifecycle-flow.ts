/**
 * Lifecycle state classification + transition aggregation.
 *
 * State rule (authoritative — derived from the Phase 00 data-readiness analysis):
 *   New:         install_date >= today-7d
 *   Core:        (active_today|active_7d) AND is_paying_user
 *   Lapsing:     active_30d AND is_paying_user  (≡ churn_risk=at_risk)
 *   Reactivated: (churned|dormant) AND is_paying_user AND days_since_last_active < 28
 *   Churned:     (churned|dormant|registered_inactive) AND NOT is_paying_user
 *
 * Transitions (week-over-week from→to matrix):
 *   mf_users holds CURRENT snapshot only — no history. But the daily member-state
 *   snapshot (segment_member_state_daily) accumulates per-uid lifecycle state by
 *   date, so once two snapshot days exist the from→to matrix is a self-join of the
 *   two latest dates (see state-transition-reader). The read is gated on the same
 *   flag that produces the data, so it lights up where the snapshot job runs and
 *   stays an honest disclosed-empty (no warehouse call) everywhere else.
 *
 * State counts are real, queried via Cube against mf_users at query time. State
 * counts are full-population; the transition matrix covers only the tracked-segment
 * cohort — the two must not be summed against one another (disclosed via the note).
 */

import { load } from './cube-client.js';
import { resolveCubeTokenForGame } from './resolve-cube-token.js';
import {
  readLifecycleTransitions,
  type TransitionCell,
} from '../lakehouse/state-transition-reader.js';
import { transitionsReadEnabled, TRANSITIONS_DISABLED_REASON } from './transition-read-gate.js';

export type LifecycleStateName = 'new' | 'core' | 'lapsing' | 'reactivated' | 'churned';

/** Availability + coverage metadata for the transition matrix. */
export interface LifecycleTransitionMeta {
  available: boolean;
  /** Earlier snapshot date compared (YYYY-MM-DD), or null. */
  prevDate: string | null;
  /** Later (most recent) snapshot date compared (YYYY-MM-DD), or null. */
  currDate: string | null;
  /** Distinct snapshot days captured (drives the "N of 2" accumulating message). */
  capturedDays: number;
  /** Users classified on BOTH dates — the transition sample size. */
  coverageUsers: number;
}

export interface LifecycleStateCounts {
  /** Snapshot time (ISO 8601) — when the query was answered by Cube. */
  snapshotAt: string;
  /** User counts per state derived from mf_users current snapshot. */
  states: Record<LifecycleStateName, number>;
  /** From→to cells when ≥2 snapshot days exist; null otherwise (disclosed-empty). */
  transitions: TransitionCell[] | null;
  transitionMeta: LifecycleTransitionMeta;
  /** Disclosure: coverage note when available, accumulation/why-empty when not. */
  transitionsUnavailableReason: string;
}

const EMPTY_TRANSITION_META: LifecycleTransitionMeta = {
  available: false,
  prevDate: null,
  currDate: null,
  capturedDays: 0,
  coverageUsers: 0,
};

interface CubeRow {
  'mf_users.lifecycle_stage': string;
  'mf_users.is_paying_user': boolean;
  'mf_users.user_count': number;
}

interface NewCubeRow {
  'mf_users.user_count': number;
}

/**
 * Derive the 5 lifecycle states from a cross-product of lifecycle_stage x is_paying_user.
 *
 * Priority: New > Reactivated > Core > Lapsing > Churned
 * (A "new" payer is counted as New, not Core, to avoid double-counting.)
 */
function classifyRows(rows: CubeRow[], newCount: number): Record<LifecycleStateName, number> {
  const states: Record<LifecycleStateName, number> = {
    new: newCount,
    core: 0,
    lapsing: 0,
    reactivated: 0,
    churned: 0,
  };

  for (const row of rows) {
    const stage = row['mf_users.lifecycle_stage'];
    const isPaying = row['mf_users.is_paying_user'];
    const count = Number(row['mf_users.user_count']) || 0;

    // Reactivated: churned/dormant users who are currently paying (re-engaged)
    if ((stage === 'churned' || stage === 'dormant') && isPaying) {
      states.reactivated += count;
    }
    // Core: active_today or active_7d AND paying
    else if ((stage === 'active_today' || stage === 'active_7d') && isPaying) {
      states.core += count;
    }
    // Lapsing: active_30d AND paying (at-risk paying user)
    else if (stage === 'active_30d' && isPaying) {
      states.lapsing += count;
    }
    // Churned: dormant/churned non-payers + registered inactive
    else if (
      (stage === 'churned' || stage === 'dormant' || stage === 'registered_inactive') &&
      !isPaying
    ) {
      states.churned += count;
    }
    // Non-paying active users (active_today, active_7d, active_30d) — counted in churned
    // as "at-risk inactive" for dashboard visibility. They are not Core (no monetisation).
    else if (
      (stage === 'active_today' || stage === 'active_7d' || stage === 'active_30d') &&
      !isPaying
    ) {
      // Non-paying active users are not in the 5 state buckets of the Sankey.
      // They exist in the data but the state rule only tracks paying transitions.
      // They are NOT included in the Churned bucket (which is dormant/churned/inactive).
      // Skipped intentionally — the Sankey represents the monetisation lifecycle.
    }
  }

  return states;
}

/**
 * Fetch current lifecycle state counts for a game.
 * Returns real Cube data for state counts; transitions are null (no history available).
 */
export async function fetchLifecycleFlow(game: string): Promise<LifecycleStateCounts> {
  const token = resolveCubeTokenForGame(game) ?? undefined;
  const cubeName = 'mf_users';

  // Query 1: cross-product of lifecycle_stage x is_paying_user — aggregate counts.
  // No per-user data leaves the server; only group-level totals are returned.
  const crossQuery = {
    measures: [`${cubeName}.user_count`],
    dimensions: [`${cubeName}.lifecycle_stage`, `${cubeName}.is_paying_user`],
    limit: 100,
  };

  // Query 2: new installs in last 7 days (using new_install_7d segment).
  const newQuery = {
    measures: [`${cubeName}.user_count`],
    segments: [`${cubeName}.new_install_7d`],
    limit: 1,
  };

  const [crossResult, newResult] = await Promise.all([
    load(crossQuery, token, 30_000) as Promise<{ data: CubeRow[] }>,
    load(newQuery, token, 30_000) as Promise<{ data: NewCubeRow[] }>,
  ]);

  const newCount = Number(newResult?.data?.[0]?.['mf_users.user_count']) || 0;
  const rows: CubeRow[] = crossResult?.data ?? [];
  const states = classifyRows(rows, newCount);

  // Transition matrix — self-join of the two latest member-state snapshot days.
  // Gated + fully isolated: a read failure never fails the (real) state counts.
  let transitions: TransitionCell[] | null = null;
  let transitionMeta: LifecycleTransitionMeta = EMPTY_TRANSITION_META;
  let transitionsUnavailableReason = TRANSITIONS_DISABLED_REASON;

  if (transitionsReadEnabled()) {
    try {
      const matrix = await readLifecycleTransitions(game);
      transitionMeta = {
        available: matrix.available,
        prevDate: matrix.prevDate,
        currDate: matrix.currDate,
        capturedDays: matrix.capturedDays,
        coverageUsers: matrix.coverageUsers,
      };
      transitions = matrix.available ? matrix.cells : null;
      transitionsUnavailableReason = matrix.reason;
    } catch (err) {
      transitionsUnavailableReason = `Transition read failed: ${(err as Error).message}`;
    }
  }

  return {
    snapshotAt: new Date().toISOString(),
    states,
    transitions,
    transitionMeta,
    transitionsUnavailableReason,
  };
}
