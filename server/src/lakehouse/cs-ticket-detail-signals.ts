/**
 * Pure (Trino-free) derivations for the CS-ticket detail layer: HTML stripping,
 * first-response latency, the account-security flag, ticket assembly from flat
 * query rows, and the row-expand summary projection.
 *
 * securityFlag intentionally requires BOTH `login_info ≠ uid` AND an account /
 * security AI label: a differing login alone is common and benign (Web/CS-portal
 * logins use a username, not the game uid), so the label is the disambiguator.
 */

import type {
  CsTicketDetail,
  CsTicketLabel,
  CsTicketMessage,
  CsTicketRating,
  CsTicketSummary,
  SentimentTrajectory,
  VipProfile,
} from './cs-ticket-detail-types.js';

/** AI-label categories/names that mark a genuine account-security ticket. Kept
 *  narrow on purpose: the CS label taxonomy uses `Account_SecurityIssue` for real
 *  security cases, while `Account_Management` / `Account_Other` are ordinary
 *  account requests — matching on the bare word "account" mislabels those (they
 *  are the bulk of account-labelled tickets). Match security-specific terms only. */
const SECURITY_LABEL = /security|hacked|hijack|stolen|steal|compromis|takeover|fraud|scam/i;

/** Strip HTML tags + decode the handful of entities CS content uses → plain text. */
export function stripHtml(html: string | null): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stripped first ~`max` chars of the latest message, for the row-expand snippet. */
export function htmlSnippet(html: string | null, max = 140): string {
  const text = stripHtml(html);
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** Minutes from ticket creation → first response; null when either is missing. */
export function firstResponseLatencyMin(createdAt: string | null, firstResponseAt: string | null): number | null {
  if (!createdAt || !firstResponseAt) return null;
  const c = Date.parse(createdAt);
  const r = Date.parse(firstResponseAt);
  if (Number.isNaN(c) || Number.isNaN(r)) return null;
  return Math.max(0, Math.round((r - c) / 60_000));
}

/** Account-takeover signal: a non-uid login AND an account/security label. */
export function buildSecurityFlag(loginInfo: string | null, uid: string, labels: CsTicketLabel[]): boolean {
  if (!loginInfo || loginInfo === uid) return false;
  return labels.some((l) => SECURITY_LABEL.test(`${l.category ?? ''} ${l.name ?? ''}`));
}

// ── Flat row shapes the reader produces (internal contract) ────────────────────

export interface ScalarRow {
  ticketId: string;
  uid: string;
  source: string;
  formName: string | null;
  openedAt: string;
  status: string | null;
  priority: number | null;
  staffDept: string | null;
  staffDomain: string | null;
  createdAt: string | null;
  firstResponseAt: string | null;
  reopenCount: number;
  sentFirst: string | null;
  sentLast: string | null;
  sentChange: string | null;
  loginInfo: string | null;
  tagName: string | null;
  ratingScore: number | null;
  vip: VipProfile | null;
  /** Final closure time (last_closed_time) ISO, or null if still open. */
  closedAt: string | null;
  /** Issue classification from cs_ticket_info.ticket_category. */
  ticketCategory: string | null;
  /** Top-level support category (cs_ticket_info.form_group), e.g. "HỖ TRỢ SẢN PHẨM". */
  formGroup: string | null;
  /** How the ticket was raised (cs_ticket_info.service_type) — "Form" = web-form-initiated. */
  serviceType: string | null;
}

export interface FlatLabel extends CsTicketLabel {
  ticketId: string;
}
export interface FlatMessage extends CsTicketMessage {
  ticketId: string;
}
export interface FlatRating extends CsTicketRating {
  ticketId: string;
}

function groupBy<T extends { ticketId: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const a = m.get(r.ticketId);
    if (a) a.push(r);
    else m.set(r.ticketId, [r]);
  }
  return m;
}

/**
 * Assemble flat query rows into `CsTicketDetail[]`, one per scalar row. Messages
 * are sorted chronologically and capped at `maxMessages` (truncation flagged);
 * the latest rating is kept as representative.
 */
export function assembleDetails(
  scalars: ScalarRow[],
  labels: FlatLabel[],
  messages: FlatMessage[],
  ratings: FlatRating[],
  maxMessages: number,
): CsTicketDetail[] {
  const labelsBy = groupBy(labels);
  const messagesBy = groupBy(messages);
  const ratingsBy = groupBy(ratings);

  return scalars.map((s) => {
    const tLabels: CsTicketLabel[] = (labelsBy.get(s.ticketId) ?? []).map((l) => ({
      category: l.category,
      name: l.name,
    }));
    const allMsgs = (messagesBy.get(s.ticketId) ?? [])
      .slice()
      .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
    const messagesTruncated = allMsgs.length > maxMessages;
    const tMessages: CsTicketMessage[] = (messagesTruncated ? allMsgs.slice(-maxMessages) : allMsgs).map((m) => ({
      at: m.at,
      isCustomer: m.isCustomer,
      text: m.text,
      attachments: m.attachments,
    }));
    const rating = (ratingsBy.get(s.ticketId) ?? [])[0] ?? null;
    const sentiment: SentimentTrajectory = { first: s.sentFirst, last: s.sentLast, change: s.sentChange };

    return {
      ticketId: s.ticketId,
      uid: s.uid,
      source: s.source,
      formName: s.formName,
      ticketCategory: s.ticketCategory,
      formGroup: s.formGroup,
      serviceType: s.serviceType,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      createdAt: s.createdAt,
      status: s.status,
      priority: s.priority,
      staffDept: s.staffDept,
      staffDomain: s.staffDomain,
      latencyMin: firstResponseLatencyMin(s.createdAt, s.firstResponseAt),
      reopenCount: s.reopenCount,
      sentiment,
      securityFlag: buildSecurityFlag(s.loginInfo, s.uid, tLabels),
      loginInfo: s.loginInfo,
      tags: s.tagName ? [s.tagName] : [],
      labels: tLabels,
      rating: rating ? { rating: rating.rating, feedback: rating.feedback, feedbackOptions: rating.feedbackOptions } : null,
      messages: tMessages,
      messagesTruncated,
      vip: s.vip,
    };
  });
}

/** Project a full detail down to the row-expand summary subset. */
export function toTicketSummary(detail: CsTicketDetail): CsTicketSummary {
  const last = detail.messages[detail.messages.length - 1];
  return {
    ticketId: detail.ticketId,
    uid: detail.uid,
    source: detail.source,
    formName: detail.formName,
    openedAt: detail.openedAt,
    status: detail.status,
    priority: detail.priority,
    latencyMin: detail.latencyMin,
    reopenCount: detail.reopenCount,
    sentiment: detail.sentiment,
    securityFlag: detail.securityFlag,
    labels: detail.labels,
    rating: detail.rating,
    messageCount: detail.messages.length,
    lastMessageSnippet: last ? htmlSnippet(last.text) : null,
  };
}
