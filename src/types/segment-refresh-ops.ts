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
  /** `error` = cards at status='error' (no last-good to show). */
  cards: { ok: number; error: number; total: number };
  /** Cards whose last refresh attempt failed (status='error' OR status='ok' with
   *  an error breadcrumb still serving last-good). ≥1 ⇒ derivedState 'degraded'. */
  failingCards: number;
  /** Age (ms) of the newest cached card; null when none. Display only. */
  newestCardAgeMs: number | null;
  /** ≥1 card failing its refresh while still serving last-good (= failingCards > cards.error). */
  cardsStale: boolean;
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
