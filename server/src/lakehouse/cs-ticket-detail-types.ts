/**
 * Shared types for the per-member CS-ticket DETAIL layer (transcript + ratings +
 * signals + VIP), distinct from the segment-level summary in `cs-ticket-reader`.
 *
 * `CsTicketDetail` is the full per-ticket object the page renders; `CsTicketSummary`
 * is the row-expand subset (no message array — just count + a stripped snippet).
 * Both are the on-the-wire API contract for `GET /api/segments/:id/members/:uid/cs-tickets`.
 */

/** CS-side VIP profile for the member, from `customers_v2` (per product). */
export interface VipProfile {
  tierId: number | null;
  vipGameProportion: number | null;
  loginChannel: string | null;
  gender: number | null;
}

/** One message in a ticket's conversation thread. `text` is HTML-stripped. */
export interface CsTicketMessage {
  /** ISO timestamp (created_date_unix is MILLISECONDS → ÷1000), or null. */
  at: string | null;
  /** true = player, false = CS staff (from `is_customer`, verified binary). */
  isCustomer: boolean;
  /** Plain text — HTML stripped server-side (no sanitizer dep; never render raw). */
  text: string;
  /** Attachment object paths from the `files` JSON array. */
  attachments: string[];
}

export interface CsTicketRating {
  rating: number | null;
  feedback: string | null;
  /** Structured complaint tags from `feedback_options` JSON. */
  feedbackOptions: string[];
}

export interface CsTicketLabel {
  category: string | null;
  name: string | null;
}

/** Sentiment first→last across the ticket lifecycle. */
export interface SentimentTrajectory {
  first: string | null;
  last: string | null;
  change: string | null;
}

/** Full per-ticket detail (page payload). */
export interface CsTicketDetail {
  ticketId: string;
  uid: string;
  /** Ingame / Web / Phone. */
  source: string;
  formName: string | null;
  /** Issue classification (cs_ticket_info.ticket_category), or null. */
  ticketCategory: string | null;
  /** Ticket date `YYYY-MM-DD`. */
  openedAt: string;
  /** Full ticket-created timestamp (ticket_created_time) ISO, or null. */
  createdAt: string | null;
  /** Final closure timestamp (last_closed_time) ISO, or null if still open. */
  closedAt: string | null;
  /** Status group (Closed / Processing / …) or null. */
  status: string | null;
  priority: number | null;
  staffDept: string | null;
  staffDomain: string | null;
  /** Minutes from created → first response, or null. */
  latencyMin: number | null;
  reopenCount: number;
  sentiment: SentimentTrajectory;
  /** login_info ≠ uid AND ticket carries an account-security label. */
  securityFlag: boolean;
  /** Raw login identifier from `tickets_v2` (may legitimately differ for Web). */
  loginInfo: string | null;
  /** Resolved hashtag(s) — 0 or 1 in v1 (single-tag TRY_CAST join). */
  tags: string[];
  labels: CsTicketLabel[];
  /** Representative (latest) rating, or null when unrated. */
  rating: CsTicketRating | null;
  messages: CsTicketMessage[];
  messagesTruncated: boolean;
  vip: VipProfile | null;
}

/** Row-expand subset — drops the message array, keeps count + snippet. */
export interface CsTicketSummary {
  ticketId: string;
  uid: string;
  source: string;
  formName: string | null;
  openedAt: string;
  status: string | null;
  priority: number | null;
  latencyMin: number | null;
  reopenCount: number;
  sentiment: SentimentTrajectory;
  securityFlag: boolean;
  labels: CsTicketLabel[];
  rating: CsTicketRating | null;
  messageCount: number;
  lastMessageSnippet: string | null;
}
