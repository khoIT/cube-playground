/**
 * Typed client for the segment CS-care overlay (GET /api/segments/:id/cs-care).
 * Mirrors the server payload in server/src/routes/segment-cs-care.ts. The Care
 * tab is gated to games with CS coverage; the endpoint 404s (NO_CS_CARE) for
 * the rest, which the tab treats as "no coverage" rather than an error.
 */

import { apiFetch } from './api-client';

export interface CsCareCoverage {
  totalMembers: number;
  contactedMembers: number;
  /** contacted / total * 100, or null when no members. */
  pct: number | null;
  /** True when the cohort was capped before querying CS. */
  truncated: boolean;
}

export interface CsCarePulse {
  tickets: number;
  contacted: number;
  openUnresolved: number;
  negativeSentiment: number;
  lowRating: number;
}

export interface CsCareIssue {
  category: string;
  tickets: number;
  members: number;
}

export interface CsCareWatchlistEntry {
  uid: string;
  name: string | null;
  ltv: number | null;
  lastCategory: string | null;
  lastSource: string;
  sentiment: string | null;
  rating: number | null;
  statusGroup: string | null;
  daysSince: number | null;
  riskScore: number;
}

export interface CsCareCohortStats {
  n: number;
  avgRevPre: number;
  avgRevPost: number;
  deltaPct: number | null;
}

export interface CsCareImpact {
  contacted: CsCareCohortStats;
  nonContacted: CsCareCohortStats;
  windowDays: number;
  smallSample: boolean;
}

/** Present only when the server served a previously-good payload after a fresh
 *  recompute failed (serve-stale-on-error). Drives the freshness badge. */
export interface CsCareStaleMeta {
  computedAt: string;
  ageMs: number;
  reason: string;
}

export interface CsCarePayload {
  segmentId: string;
  gameId: string;
  productId: number;
  coverage: CsCareCoverage;
  freshness: { csMaxLogDate: string | null };
  pulse: CsCarePulse;
  issueMix: CsCareIssue[];
  watchlist: CsCareWatchlistEntry[];
  csImpact: CsCareImpact | null;
  stale?: CsCareStaleMeta;
}

export function fetchSegmentCsCare(id: string): Promise<CsCarePayload> {
  return apiFetch<CsCarePayload>(`/api/segments/${encodeURIComponent(id)}/cs-care`);
}

/**
 * Games with a validated CS product mapping (mirrors the server's
 * cs-product-map). Used only to decide whether to show the Care tab — the
 * server is the source of truth and re-checks on the request.
 * Keep in sync with cs-product-map.ts + the game alias map: a covered game
 * missing here only hides the tab (the endpoint still works), never breaks it.
 */
const CS_COVERAGE_GAMES = new Set(['jus', 'jus_vn', 'cfm', 'cfm_vn']);

export function hasCsCoverage(gameId: string | null | undefined): boolean {
  return gameId != null && CS_COVERAGE_GAMES.has(gameId);
}
