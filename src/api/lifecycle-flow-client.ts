/**
 * Client for GET /api/lifecycle-flow — current lifecycle state counts.
 *
 * State counts are real Cube queries (mf_users current snapshot).
 * Transitions are null — mf_users has no history; the server discloses the
 * reason via `transitionsUnavailableReason` so the UI renders an honest
 * empty-state instead of fabricated flow ribbons.
 */
import { apiFetch } from './api-client';

export type LifecycleStateName = 'new' | 'core' | 'lapsing' | 'reactivated' | 'churned';

export interface LifecycleFlowResponse {
  snapshotAt: string;
  states: Record<LifecycleStateName, number>;
  /** Always null — transitions require historical data not yet available. */
  transitions: null;
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
