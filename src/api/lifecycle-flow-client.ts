/**
 * Client for GET /api/lifecycle-flow — current lifecycle state counts.
 *
 * State counts are real Cube queries (mf_users current snapshot, full population).
 * Transitions are a self-join of the two latest daily member-state snapshots:
 * populated once two snapshot days exist, else null with a disclosed reason so
 * the UI renders an honest empty-state instead of fabricated flow ribbons. The
 * transition matrix covers only the tracked-segment cohort (a subset), so its
 * flows must not be summed against the full-population node counts.
 */
import { apiFetch } from './api-client';

export type LifecycleStateName = 'new' | 'core' | 'lapsing' | 'reactivated' | 'churned';

/** One from→to cell of the lifecycle transition matrix. */
export interface TransitionCell {
  from: string;
  to: string;
  count: number;
}

export interface LifecycleTransitionMeta {
  available: boolean;
  prevDate: string | null;
  currDate: string | null;
  capturedDays: number;
  coverageUsers: number;
}

export interface LifecycleFlowResponse {
  snapshotAt: string;
  states: Record<LifecycleStateName, number>;
  /** From→to cells when ≥2 snapshot days exist; null otherwise (disclosed-empty). */
  transitions: TransitionCell[] | null;
  transitionMeta: LifecycleTransitionMeta;
  /** Coverage note when available; accumulation/why-empty reason when not. */
  transitionsUnavailableReason: string;
}

export async function fetchLifecycleFlow(
  game: string,
  signal?: AbortSignal,
): Promise<LifecycleFlowResponse> {
  return apiFetch<LifecycleFlowResponse>('/api/lifecycle-flow', {
    query: { game },
    signal,
  });
}
