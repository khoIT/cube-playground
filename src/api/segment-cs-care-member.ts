/**
 * Typed client for the per-member CS-ticket detail endpoint
 * (GET /api/segments/:id/members/:uid/cs-tickets). Mirrors the server payload in
 * server/src/routes/segment-cs-tickets.ts + cs-ticket-detail-types.ts.
 *
 * Backs both the Care-watchlist row-expand (which reads only the summary subset
 * of each ticket) and the Care History 360 page (full transcript). One endpoint,
 * one fetch — the row-expand simply ignores `messages`/`vip`.
 */

import { apiFetch } from './api-client';

export interface CsTicketVipProfile {
  tierId: number | null;
  vipGameProportion: number | null;
  loginChannel: string | null;
  gender: number | null;
}

export interface CsTicketMessage {
  /** ISO timestamp (server already converted ms→s), or null. */
  at: string | null;
  /** true = player, false = CS staff. */
  isCustomer: boolean;
  /** Plain text — HTML already stripped server-side. */
  text: string;
  attachments: string[];
}

export interface CsTicketRating {
  rating: number | null;
  feedback: string | null;
  feedbackOptions: string[];
}

export interface CsTicketLabel {
  category: string | null;
  name: string | null;
}

export interface CsTicketSentiment {
  first: string | null;
  last: string | null;
  change: string | null;
}

export interface CsTicketDetail {
  ticketId: string;
  uid: string;
  source: string;
  formName: string | null;
  /** Issue classification (ticket_category), or null. */
  ticketCategory: string | null;
  openedAt: string;
  /** Full ticket-created timestamp ISO, or null. */
  createdAt: string | null;
  /** Final closure timestamp ISO, or null if still open. */
  closedAt: string | null;
  status: string | null;
  priority: number | null;
  staffDept: string | null;
  staffDomain: string | null;
  latencyMin: number | null;
  reopenCount: number;
  sentiment: CsTicketSentiment;
  securityFlag: boolean;
  loginInfo: string | null;
  tags: string[];
  labels: CsTicketLabel[];
  rating: CsTicketRating | null;
  messages: CsTicketMessage[];
  messagesTruncated: boolean;
  vip: CsTicketVipProfile | null;
}

export interface CsTicketRecharge {
  n: number;
  avgRevPre: number;
  avgRevPost: number;
  /** (post − pre) / pre × 100, or null when pre is 0. */
  deltaPct: number | null;
  windowDays: number;
}

export interface CsTicketsPayload {
  segmentId: string;
  gameId: string;
  productId: number;
  uid: string;
  member: { name: string | null; ltv: number | null };
  coverage: { joined: boolean; note: string | null };
  freshness: { csMaxLogDate: string | null };
  /** Pre/post recharge around the first CS contact; null when unavailable. */
  recharge: CsTicketRecharge | null;
  tickets: CsTicketDetail[];
}

export function fetchMemberCsTickets(segmentId: string, uid: string): Promise<CsTicketsPayload> {
  return apiFetch<CsTicketsPayload>(
    `/api/segments/${encodeURIComponent(segmentId)}/members/${encodeURIComponent(uid)}/cs-tickets`,
  );
}
