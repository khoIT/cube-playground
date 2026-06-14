/**
 * Per-member CS-ticket DETAIL reader off `iceberg.cs_ticket` — the deep view
 * behind `GET /api/segments/:id/members/:uid/cs-tickets`. Where `cs-ticket-reader`
 * returns one summary row per ticket for a whole cohort, this returns the FULL
 * thread (conversation messages + ratings + AI labels + envelope + VIP) for a
 * single uid.
 *
 * Shape: one scalar query (1 row/ticket: info spine + master + status + tickets_v2
 * + customers_v2 + single-tag resolution), then labels / messages / ratings fetched
 * in parallel for just the matched ticket ids and grouped in JS (each is N/ticket,
 * so a flat join would fan out — keep them separate). Same dedup + caveats as the
 * summary reader: NEVER `cs_ticket_master`; comms timestamps are MILLISECONDS.
 */

import { runQuery } from '../services/trino-rest-client.js';
import { type Connector } from '../services/trino-profiler-config.js';
import { resolveCsTrinoConnector } from './cs-trino-connector.js';
import { toSqlLiteral } from './inline-sql-params.js';
import { CS_READ_TIMEOUT_MS } from './cs-ticket-reader.js';
import {
  assembleDetails,
  stripHtml,
  type FlatLabel,
  type FlatMessage,
  type FlatRating,
  type ScalarRow,
} from './cs-ticket-detail-signals.js';
import type { CsTicketDetail, VipProfile } from './cs-ticket-detail-types.js';

const CS = 'iceberg.cs_ticket';

export interface DetailCaps {
  maxTickets: number;
  maxMessagesPerTicket: number;
  maxRatingsPerTicket: number;
}

export const DEFAULT_DETAIL_CAPS: DetailCaps = {
  maxTickets: 60,
  maxMessagesPerTicket: 80,
  maxRatingsPerTicket: 10,
};

export interface FetchCsTicketDetailOptions {
  productId: number;
  uid: string;
  /** Inclusive lower bound on `log_date`, `YYYY-MM-DD`. */
  sinceDate: string;
  caps?: Partial<DetailCaps>;
  connector?: Connector;
}

/** Single-uid sanitize — ids in our store are alphanumeric; reject anything else. */
function sanitizeUid(uid: string): string | null {
  const u = String(uid).trim();
  return u && /^[A-Za-z0-9_-]+$/.test(u) ? u : null;
}

function ticketInList(ids: string[]): string {
  // ticket_id is bigint; ids arrive as digit strings — keep only digits.
  return ids.filter((t) => /^\d+$/.test(t)).join(', ');
}

function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function num(v: unknown): number | null {
  return v == null ? null : Number(v);
}
function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

function buildScalarsSql(productId: number, uid: string, since: string, maxTickets: number): string {
  const u = toSqlLiteral(uid);
  const s = toSqlLiteral(since);
  return (
    `WITH matched AS (` +
    `SELECT ticket_id, split_part(user_id,'@',1) AS uid, customer_id, ` +
    `CAST(log_date AS varchar) AS log_date, ticket_source, form_name, ticket_category, ` +
    `row_number() OVER (PARTITION BY ticket_id ORDER BY run_date DESC) AS rn ` +
    `FROM ${CS}.cs_ticket_info ` +
    `WHERE product_id = ${productId} AND log_date >= DATE ${s} AND split_part(user_id,'@',1) = ${u}), ` +
    `master AS (` +
    `SELECT ticket_id, CAST(ticket_created_time AS varchar) created, ` +
    `CAST(first_responsed_time AS varchar) first_resp, CAST(last_closed_time AS varchar) closed, ` +
    `total_reopened_times reopens, ` +
    `first_sentiment_status_desc sent_first, last_sentiment_status_desc sent_last, ` +
    `sentiment_change, ticket_rating, staff_dept, staff_domain, status_id, ` +
    `row_number() OVER (PARTITION BY ticket_id ORDER BY run_date DESC, last_updated_time DESC) AS rn ` +
    `FROM ${CS}.cs_ticket_new_master ` +
    `WHERE run_date >= DATE ${s} AND ticket_id IN (SELECT ticket_id FROM matched WHERE rn = 1)) ` +
    `SELECT i.uid, CAST(i.ticket_id AS varchar) AS ticket_id, i.log_date, i.ticket_source, i.form_name, ` +
    `m.created, m.first_resp, m.reopens, m.sent_first, m.sent_last, m.sentiment_change, ` +
    `m.ticket_rating, m.staff_dept, m.staff_domain, st.status_group, ` +
    `v.priority, v.login_info, tt.value AS tag_name, ` +
    `c.tier_id, c.vip_game_proportion, c.login_channel, c.gender, ` +
    `m.closed, i.ticket_category ` +
    `FROM matched i ` +
    `LEFT JOIN master m ON m.ticket_id = i.ticket_id AND m.rn = 1 ` +
    `LEFT JOIN ${CS}.cs_map_status st ON st.status_id = m.status_id ` +
    `LEFT JOIN ${CS}.tickets_v2 v ON v.ticket_id = i.ticket_id ` +
    `LEFT JOIN ${CS}.tag_translation_v2 tt ON tt.tag_id = TRY_CAST(v.tags AS bigint) AND tt.key = 'tag_name' AND tt.language_id = 1 ` +
    `LEFT JOIN ${CS}.customers_v2 c ON c.customer_id = i.customer_id ` +
    `WHERE i.rn = 1 ORDER BY i.log_date DESC LIMIT ${maxTickets}`
  );
}

function buildLabelsSql(ticketIds: string[]): string {
  return (
    `SELECT CAST(ticket_id AS varchar) tid, label_category, label_name, ` +
    `row_number() OVER (PARTITION BY ticket_id, label_id ORDER BY run_date DESC) AS rn ` +
    `FROM ${CS}.cs_ticket_map_ai_label WHERE ticket_id IN (${ticketInList(ticketIds)})`
  );
}

function buildCommsSql(ticketIds: string[], maxPerTicket: number): string {
  return (
    `SELECT tid, is_customer, at, content, files FROM (` +
    `SELECT CAST(ticket_id AS varchar) tid, is_customer, ` +
    `CAST(from_unixtime(created_date_unix/1000) AS varchar) at, content, files, ` +
    `row_number() OVER (PARTITION BY ticket_id ORDER BY created_date_unix DESC) AS rn ` +
    `FROM ${CS}.ticket_communications_centralized ` +
    `WHERE ticket_id IN (${ticketInList(ticketIds)}) AND coalesce(is_deleted,0) = 0` +
    `) WHERE rn <= ${maxPerTicket}`
  );
}

function buildRatingsSql(ticketIds: string[], maxPerTicket: number): string {
  return (
    `SELECT tid, rating, feedback, feedback_options FROM (` +
    `SELECT CAST(ticket_id AS varchar) tid, rating, feedback, feedback_options, ` +
    `row_number() OVER (PARTITION BY ticket_id ORDER BY created_date_unix DESC) AS rn ` +
    `FROM ${CS}.ticket_ratings_centralized ` +
    `WHERE ticket_id IN (${ticketInList(ticketIds)}) AND coalesce(is_deleted,0) = 0` +
    `) WHERE rn <= ${maxPerTicket}`
  );
}

function mapScalar(r: unknown[]): ScalarRow {
  const tierId = num(r[18]);
  const vipProportion = num(r[19]);
  const loginChannel = str(r[20]);
  const gender = num(r[21]);
  const vip: VipProfile | null =
    tierId == null && vipProportion == null && loginChannel == null && gender == null
      ? null
      : { tierId, vipGameProportion: vipProportion, loginChannel, gender };
  return {
    uid: String(r[0]),
    ticketId: String(r[1]),
    openedAt: String(r[2]),
    source: r[3] == null ? '' : String(r[3]),
    formName: str(r[4]),
    createdAt: str(r[5]),
    firstResponseAt: str(r[6]),
    reopenCount: num(r[7]) ?? 0,
    sentFirst: str(r[8]),
    sentLast: str(r[9]),
    sentChange: str(r[10]),
    ratingScore: num(r[11]),
    staffDept: str(r[12]),
    staffDomain: str(r[13]),
    status: str(r[14]),
    priority: num(r[15]),
    loginInfo: str(r[16]),
    tagName: str(r[17]),
    vip,
    closedAt: str(r[22]),
    ticketCategory: str(r[23]),
  };
}

/**
 * Fetch full ticket detail for a single member. Empty/sanitized-out uid or no
 * matched tickets short-circuits to `[]` without touching Trino downstream.
 */
export async function fetchCsTicketDetail(opts: FetchCsTicketDetailOptions): Promise<CsTicketDetail[]> {
  const uid = sanitizeUid(opts.uid);
  if (!uid) return [];
  const caps = { ...DEFAULT_DETAIL_CAPS, ...opts.caps };
  const connector = opts.connector ?? resolveCsTrinoConnector();
  if (!connector) throw new Error('CS ticket detail reader: no Trino connector configured');

  const scalarRes = await runQuery(
    connector,
    connector.catalog,
    buildScalarsSql(opts.productId, uid, opts.sinceDate, caps.maxTickets),
    CS_READ_TIMEOUT_MS,
  );
  const scalars = scalarRes.rows.map(mapScalar);
  if (scalars.length === 0) return [];

  const ids = scalars.map((s) => s.ticketId);
  const [labelRes, commsRes, ratingRes] = await Promise.all([
    runQuery(connector, connector.catalog, buildLabelsSql(ids), CS_READ_TIMEOUT_MS),
    runQuery(connector, connector.catalog, buildCommsSql(ids, caps.maxMessagesPerTicket), CS_READ_TIMEOUT_MS),
    runQuery(connector, connector.catalog, buildRatingsSql(ids, caps.maxRatingsPerTicket), CS_READ_TIMEOUT_MS),
  ]);

  const labels: FlatLabel[] = labelRes.rows
    .filter((r) => Number(r[3]) === 1) // rn=1 per (ticket,label_id) — dedup partition reruns
    .map((r) => ({ ticketId: String(r[0]), category: str(r[1]), name: str(r[2]) }));
  const messages: FlatMessage[] = commsRes.rows.map((r) => ({
    ticketId: String(r[0]),
    isCustomer: Number(r[1]) === 1,
    at: str(r[2]),
    text: stripHtml(str(r[3])),
    attachments: parseJsonArray(r[4]),
  }));
  const ratings: FlatRating[] = ratingRes.rows.map((r) => ({
    ticketId: String(r[0]),
    rating: num(r[1]),
    feedback: str(r[2]),
    feedbackOptions: parseJsonArray(r[3]),
  }));

  return assembleDetails(scalars, labels, messages, ratings, caps.maxMessagesPerTicket);
}
