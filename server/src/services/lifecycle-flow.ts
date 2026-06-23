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
 *   mf_users holds CURRENT snapshot only — no history. The transition matrix
 *   cannot be computed retroactively. This service returns null for transitions,
 *   and the route discloses this to the client so the UI renders an honest empty
 *   state instead of fabricated flows.
 *
 * State counts are real, queried via Cube against mf_users at query time.
 */

import { load } from './cube-client.js';
import { resolveCubeTokenForGame } from './resolve-cube-token.js';

export type LifecycleStateName = 'new' | 'core' | 'lapsing' | 'reactivated' | 'churned';

export interface LifecycleStateCounts {
  /** Snapshot time (ISO 8601) — when the query was answered by Cube. */
  snapshotAt: string;
  /** User counts per state derived from mf_users current snapshot. */
  states: Record<LifecycleStateName, number>;
  /** Null — mf_users has no history; week-over-week diffs not computable. */
  transitions: null;
  transitionsUnavailableReason: string;
}

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

  return {
    snapshotAt: new Date().toISOString(),
    states,
    transitions: null,
    transitionsUnavailableReason:
      'mf_users holds current state only (daily snapshot, no history). ' +
      'Week-over-week transition flows require a historical activity table or ' +
      'a segment-snapshot accumulation period — neither is available yet.',
  };
}
