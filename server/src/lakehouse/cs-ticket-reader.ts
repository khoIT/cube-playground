/**
 * Read-only reader for CS ticket history scoped to a set of segment member
 * uids, off `iceberg.cs_ticket`.
 *
 * Coverage is partial by design: only Ingame/Web/Phone tickets carry the
 * 19-digit game uid in `cs_ticket_info.user_id` that joins to segment members.
 * Facebook/AIHelp tickets (~90% of volume) carry a channel PSID instead and are
 * unjoinable, so the reader returns matched rows only — callers compute the
 * "X of N members contacted" ratio against their own membership count.
 *
 * Grain is one row per ticket: `cs_ticket_info` (channel + uid + date) is the
 * spine, deduped to its latest run_date partition. Both `cs_ticket_new_master`
 * (sentiment / rating / status) and the AI label table carry MULTIPLE rows per
 * ticket (the ticket evolves across monthly partitions / accrues labels), so
 * each is reduced to a single representative row before the join — master to
 * its latest run, the label to its first category — keeping ticket counts exact.
 *
 * NB: `cs_ticket_master` has a stale Iceberg metadata pointer and errors on
 * read — always `cs_ticket_new_master`.
 */

import { runQuery } from '../services/trino-rest-client.js';
import { getConnector, type Connector } from '../services/trino-profiler-config.js';
import { toSqlLiteral } from './inline-sql-params.js';

/** CS schema lives behind the `iceberg` catalog; tables are fully qualified so
 *  the session catalog (game_integration on the profiler connector) is moot. */
const CS = 'iceberg.cs_ticket';

/** CS cold scans run 3.5–15s; give the cross-catalog join generous headroom. */
export const CS_READ_TIMEOUT_MS = 30_000;

/** Max uids per `IN (...)` batch — whale segments are a few hundred, so this is
 *  effectively one batch, but chunk defensively to bound statement size. */
const UID_CHUNK = 1000;

/** Status groups that mean the ticket is no longer in flight. */
const RESOLVED_STATUS = new Set(['Closed', 'Rejected']);

export interface CsTicketRow {
  /** Game uid (split_part(user_id,'@',1)) — joins to segment member uid. */
  uid: string;
  ticketId: string;
  /** Ticket log date, `YYYY-MM-DD`. */
  logDate: string;
  /** Channel: Ingame / Web / Phone (Facebook/AIHelp are unjoinable, excluded). */
  source: string;
  labelCategory: string | null;
  labelName: string | null;
  /** Negative / Positive / Neutral, or null when no sentiment was scored. */
  sentiment: string | null;
  /** Average ticket rating, 1–5, or null when unrated. */
  rating: number | null;
  statusGroup: string | null;
}

export interface CsPulse {
  tickets: number;
  contacted: number;
  openUnresolved: number;
  negativeSentiment: number;
  lowRating: number;
}

export interface CsIssueMixEntry {
  category: string;
  tickets: number;
  members: number;
}

export interface FetchCsTicketsOptions {
  productId: number;
  uids: string[];
  /** Inclusive lower bound on `log_date`, `YYYY-MM-DD`. */
  sinceDate: string;
  /** Injectable for tests; defaults to the env profiler connector. */
  connector?: Connector;
}

/** Keep only uids safe to inline — our uids are numeric/alphanumeric ids from
 *  our own store; anything else is rejected rather than escaped. */
function sanitizeUids(uids: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of uids) {
    const u = String(raw).trim();
    if (u && /^[A-Za-z0-9_-]+$/.test(u)) seen.add(u);
  }
  return [...seen];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildSql(productId: number, uids: string[], sinceDate: string): string {
  const inList = uids.map((u) => toSqlLiteral(u)).join(', ');
  const since = toSqlLiteral(sinceDate);
  return (
    `WITH matched AS (` +
    `SELECT ticket_id, split_part(user_id, '@', 1) AS uid, log_date, ticket_source, ` +
    `row_number() OVER (PARTITION BY ticket_id ORDER BY run_date DESC) AS rn ` +
    `FROM ${CS}.cs_ticket_info ` +
    `WHERE product_id = ${productId} AND log_date >= DATE ${since} ` +
    `AND split_part(user_id, '@', 1) IN (${inList})), ` +
    `label AS (` +
    `SELECT ticket_id, label_category, label_name, ` +
    `row_number() OVER (PARTITION BY ticket_id ORDER BY label_id) AS rn ` +
    `FROM ${CS}.cs_ticket_map_ai_label ` +
    `WHERE log_date >= DATE ${since} ` +
    `AND ticket_id IN (SELECT ticket_id FROM matched WHERE rn = 1)), ` +
    `master AS (` +
    `SELECT ticket_id, last_sentiment_status_desc, ticket_rating, status_id, ` +
    `row_number() OVER (PARTITION BY ticket_id ORDER BY run_date DESC, last_updated_time DESC) AS rn ` +
    `FROM ${CS}.cs_ticket_new_master ` +
    // run_date is the partition; a master row for an in-range ticket always
    // materializes on/after the ticket's date, so this prunes old partitions
    // without dropping any matched ticket's latest row.
    `WHERE run_date >= DATE ${since} ` +
    `AND ticket_id IN (SELECT ticket_id FROM matched WHERE rn = 1)) ` +
    `SELECT i.uid, CAST(i.ticket_id AS varchar) AS ticket_id, CAST(i.log_date AS varchar) AS log_date, ` +
    `i.ticket_source, l.label_category, l.label_name, ` +
    `m.last_sentiment_status_desc AS sentiment, m.ticket_rating, s.status_group ` +
    `FROM matched i ` +
    `LEFT JOIN master m ON m.ticket_id = i.ticket_id AND m.rn = 1 ` +
    `LEFT JOIN label l ON l.ticket_id = i.ticket_id AND l.rn = 1 ` +
    `LEFT JOIN ${CS}.cs_map_status s ON s.status_id = m.status_id ` +
    `WHERE i.rn = 1 ORDER BY i.log_date DESC`
  );
}

function mapRow(r: unknown[]): CsTicketRow {
  return {
    uid: String(r[0]),
    ticketId: String(r[1]),
    logDate: String(r[2]),
    source: r[3] == null ? '' : String(r[3]),
    labelCategory: r[4] == null ? null : String(r[4]),
    labelName: r[5] == null ? null : String(r[5]),
    sentiment: r[6] == null ? null : String(r[6]),
    rating: r[7] == null ? null : Number(r[7]),
    statusGroup: r[8] == null ? null : String(r[8]),
  };
}

/**
 * Fetch per-ticket CS rows for the given members + product. Empty/sanitized-out
 * uids short-circuit to `[]` without touching Trino. Multiple uid chunks are
 * queried sequentially (whale segments are one chunk in practice).
 */
export async function fetchCsTickets(opts: FetchCsTicketsOptions): Promise<CsTicketRow[]> {
  const uids = sanitizeUids(opts.uids);
  if (uids.length === 0) return [];
  const connector = opts.connector ?? getConnector();
  if (!connector) throw new Error('CS ticket reader: no Trino connector configured');

  const rows: CsTicketRow[] = [];
  for (const part of chunk(uids, UID_CHUNK)) {
    const sql = buildSql(opts.productId, part, opts.sinceDate);
    const res = await runQuery(connector, connector.catalog, sql, CS_READ_TIMEOUT_MS);
    for (const r of res.rows) rows.push(mapRow(r));
  }
  return rows;
}

/**
 * Pure rollup of ticket rows → pulse counts + issue mix. No Trino access, so
 * it's trivially unit-testable over fixture rows.
 */
export function summarizeCsTickets(rows: CsTicketRow[]): {
  pulse: CsPulse;
  issueMix: CsIssueMixEntry[];
} {
  const contacted = new Set<string>();
  let openUnresolved = 0;
  let negativeSentiment = 0;
  let lowRating = 0;

  // category → { tickets, distinct members }
  const mix = new Map<string, { tickets: number; members: Set<string> }>();

  for (const row of rows) {
    contacted.add(row.uid);
    if (row.statusGroup && !RESOLVED_STATUS.has(row.statusGroup)) openUnresolved += 1;
    if (row.sentiment === 'Negative') negativeSentiment += 1;
    if (row.rating != null && row.rating <= 2) lowRating += 1;

    const cat = row.labelCategory ?? 'Uncategorized';
    let bucket = mix.get(cat);
    if (!bucket) {
      bucket = { tickets: 0, members: new Set<string>() };
      mix.set(cat, bucket);
    }
    bucket.tickets += 1;
    bucket.members.add(row.uid);
  }

  const issueMix: CsIssueMixEntry[] = [...mix.entries()]
    .map(([category, b]) => ({ category, tickets: b.tickets, members: b.members.size }))
    .sort((a, b) => b.tickets - a.tickets || a.category.localeCompare(b.category));

  return {
    pulse: {
      tickets: rows.length,
      contacted: contacted.size,
      openUnresolved,
      negativeSentiment,
      lowRating,
    },
    issueMix,
  };
}
