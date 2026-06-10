/**
 * Wire types for the segment-refresh cron monitor (GET /api/segment-refresh/ops).
 * Mirror server/src/services/segment-refresh-ops.ts — keep in sync.
 */

export type DerivedRefreshState =
  | 'healthy'
  | 'due'
  | 'in_flight'
  | 'wedged'
  | 'serving_stale'
  | 'broken'
  | 'degraded';

export interface ErroringCard {
  cardId: string;
  error: string | null;
}

export interface SegmentRefreshOpsRow {
  id: string;
  name: string;
  gameId: string;
  workspace: string;
  status: string;
  derivedState: DerivedRefreshState;
  lastRefreshedAt: string | null;
  cadenceMin: number | null;
  ageMs: number | null;
  overdueByMs: number;
  uidCount: number;
  brokenReason: string | null;
  cards: { ok: number; error: number; total: number };
  erroringCards: ErroringCard[];
}

export interface CronHeartbeat {
  lastTickAt: string | null;
  tickIntervalMs: number;
  sinceLastTickMs: number | null;
}

export interface SegmentRefreshOpsSummary {
  total: number;
  wedged: number;
  degraded: number;
  servingStale: number;
  broken: number;
  inFlight: number;
  due: number;
  healthy: number;
}

export interface SegmentRefreshOpsPayload {
  generatedAt: string;
  cron: CronHeartbeat;
  queue: { processing: boolean; size: number };
  watchdog: { enabled: boolean; wedgeFloorMin: number };
  summary: SegmentRefreshOpsSummary;
  segments: SegmentRefreshOpsRow[];
}
