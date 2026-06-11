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
  queue: {
    processing: boolean;
    /** Segments waiting behind the in-flight one — excludes the running id. */
    size: number;
    runningId: string | null;
    queuedIds: string[];
  };
  watchdog: { enabled: boolean; wedgeFloorMin: number };
  summary: SegmentRefreshOpsSummary;
  segments: SegmentRefreshOpsRow[];
}

// ── Live per-card refresh progress (GET /api/segment-refresh/:id/progress) ────
// Mirror server/src/services/card-progress.ts — keep in sync.

export type CardPhase = 'queued' | 'running' | 'ok' | 'error';

export interface CardProgressEntry {
  cardId: string;
  phase: CardPhase;
}

export interface SegmentCardProgress {
  segmentId: string;
  startedAt: string;
  /** ISO when the pass ended; null while still running. */
  finishedAt: string | null;
  total: number;
  /** ok + error (settled cards). */
  done: number;
  ok: number;
  error: number;
  /** Per-card phase, in stable spec order. */
  cards: CardProgressEntry[];
}
