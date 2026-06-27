/**
 * Paginated full-cohort reader for a segment's members.
 *
 * Powers `page_id` pagination: page 1 (no token) pins the cohort snapshot, every
 * subsequent page walks a uid keyset over that pinned snapshot, so the whole pull
 * is point-in-time stable (page N belongs to the same cohort as page 1).
 *
 * Two sources:
 *   daily  — predicate segments read the nightly Iceberg `segment_membership_daily`
 *            partition (pre-deduped). Page 1 pins (snapshot_date, snapshot_ts) =
 *            the latest available; no partition → NoSnapshotError (the route maps
 *            it to 409, never a silent-empty page).
 *   manual — uid-list segments page from `uid_list_json` in memory (small cohorts
 *            by construction).
 *
 * Pure module: the Trino read is injected as a `query` fn so the reader is unit-
 * testable with no HTTP, no auth, no live warehouse. SQL literals go through
 * `toSqlLiteral` (injection-safe by construction), and the keyset/NULL-ts
 * predicate mirrors the existing snapshot reads (segment-overlap-counts.ts,
 * segment-export-stream.ts) rather than re-deriving the set-resolution logic.
 */

import { toSqlLiteral } from '../lakehouse/inline-sql-params.js';
import { SEGMENT_MEMBERSHIP_DAILY } from '../lakehouse/lakehouse-trino-connector.js';
import {
  decodePageToken,
  encodePageToken,
  InvalidPageTokenError,
  type PageSource,
  type PageToken,
} from './segment-page-token.js';

export { InvalidPageTokenError } from './segment-page-token.js';

/** Thrown when a predicate segment has no daily partition to pin. Route → 409. */
export class NoSnapshotError extends Error {
  constructor(public readonly segmentId: string) {
    super(`No snapshot partition for segment ${segmentId}; refresh the segment first.`);
    this.name = 'NoSnapshotError';
  }
}

/** Minimal segment shape the reader needs (subset of the stored row). */
export interface PageSegment {
  id: string;
  game_id: string;
  type?: string | null;
  uid_count?: number | null;
  uid_list_json?: string | null;
}

/** Runs a SQL string and yields row-major results (matches TrinoResult.rows).
 *  The route supplies one backed by the lakehouse connector; tests inject a mock. */
export type RowQueryFn = (sql: string) => Promise<unknown[][]>;

export interface ReadPageInput {
  segment: PageSegment;
  /** Rows per page; clamped to [1, MAX_LIMIT], default DEFAULT_LIMIT. */
  limit?: number;
  /** Opaque token from the previous page; absent on page 1. */
  pageId?: string;
}

export interface PageResult {
  uids: string[];
  /** Server-side cohort size, constant across pages, never read from the token. */
  total_count: number;
  /** Token for the next page, or null when the cohort is exhausted. */
  next_page_id: string | null;
  has_more: boolean;
  /** Pinned snapshot ts this page served from (daily source); null for manual or
   *  a legacy NULL-ts partition. Sourced from the RESULT so per-page audit can read
   *  it even on page 1 (which carries no incoming token to decode). */
  snapshotTs: string | null;
  /** 0-based index of this page (page 1 = 0). */
  pageIndex: number;
}

export const DEFAULT_LIMIT = 1000;
export const MAX_LIMIT = 10_000;

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || limit === undefined) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
}

/** Read one page of a segment's cohort. */
export async function readPage(input: ReadPageInput, query: RowQueryFn): Promise<PageResult> {
  const { segment } = input;
  const limit = clampLimit(input.limit);

  let token: PageToken | null = null;
  if (input.pageId) {
    token = decodePageToken(input.pageId);
    // A token can only walk the segment it was minted for; the path is already
    // scope-checked, so this blocks re-pointing the cursor at another cohort.
    if (token.segmentId !== segment.id) {
      throw new InvalidPageTokenError('page_id does not belong to this segment');
    }
  }

  const source: PageSource = token ? token.source : segment.type === 'manual' ? 'manual' : 'daily';
  return source === 'manual'
    ? readManualPage(segment, limit, token)
    : readDailyPage(segment, limit, token, query);
}

// ---- manual source ---------------------------------------------------------

function readManualPage(segment: PageSegment, limit: number, token: PageToken | null): PageResult {
  let all: string[];
  try {
    const parsed = JSON.parse(segment.uid_list_json ?? '[]');
    // Dedup before the keyset: a uid > lastUid scan advances past the cursor, so
    // a duplicate straddling a page boundary would be skipped. Mirrors the
    // tokenless route's hardening and keeps total_count self-consistent.
    all = Array.isArray(parsed) ? [...new Set(parsed.map((u) => String(u)))] : [];
  } catch {
    all = [];
  }
  // uid-ordered keyset — sort ascending so slices are deterministic and disjoint.
  all.sort();

  const lastUid = token?.lastUid ?? '';
  const start = lastUid ? firstIndexAfter(all, lastUid) : 0;
  const slice = all.slice(start, start + limit);
  const hasMore = start + slice.length < all.length;
  const thisPageIndex = token?.pageIndex ?? 0;

  return {
    uids: slice,
    total_count: all.length,
    has_more: hasMore,
    // Manual segments page from the in-memory uid list — no pinned warehouse
    // snapshot, so freshness is "unknown" (null) to the audit, not a failure.
    snapshotTs: null,
    pageIndex: thisPageIndex,
    next_page_id:
      hasMore && slice.length > 0
        ? encodePageToken({
            v: 1,
            source: 'manual',
            segmentId: segment.id,
            lastUid: slice[slice.length - 1],
            pageIndex: thisPageIndex + 1,
          })
        : null,
  };
}

/** Index of the first element strictly greater than `uid` (binary search on a
 *  sorted ascending array). */
function firstIndexAfter(sorted: string[], uid: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= uid) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ---- daily source ----------------------------------------------------------

async function readDailyPage(
  segment: PageSegment,
  limit: number,
  token: PageToken | null,
  query: RowQueryFn,
): Promise<PageResult> {
  const gameLit = toSqlLiteral(segment.game_id);
  const segLit = toSqlLiteral(segment.id);

  let snapshotDate: string;
  let snapshotTs: string | null;
  let lastUid: string;

  if (token) {
    // Subsequent pages reuse the pinned partition from the token (point-in-time).
    if (!token.snapshotDate) {
      throw new InvalidPageTokenError('page_id is missing the pinned snapshot date');
    }
    snapshotDate = token.snapshotDate;
    snapshotTs = token.snapshotTs ?? null;
    lastUid = token.lastUid;
  } else {
    // Page 1: pin the latest (snapshot_date, snapshot_ts) for this segment.
    const dateRows = await query(
      `SELECT max(snapshot_date) FROM ${SEGMENT_MEMBERSHIP_DAILY} ` +
        `WHERE segment_id = ${segLit} AND game_id = ${gameLit}`,
    );
    const pinnedDate = dateRows[0]?.[0];
    if (pinnedDate === null || pinnedDate === undefined) throw new NoSnapshotError(segment.id);
    snapshotDate = String(pinnedDate);

    const tsRows = await query(
      `SELECT max(snapshot_ts) FROM ${SEGMENT_MEMBERSHIP_DAILY} ` +
        `WHERE segment_id = ${segLit} AND game_id = ${gameLit} ` +
        `AND snapshot_date = DATE ${toSqlLiteral(snapshotDate)}`,
    );
    const pinnedTs = tsRows[0]?.[0];
    snapshotTs = pinnedTs === null || pinnedTs === undefined ? null : String(pinnedTs);
    lastUid = '';
  }

  // NULL-tolerant ts predicate: legacy rows have a NULL snapshot_ts and read as
  // the date's single bucket; a real ts pins that sub-daily capture. Mirrors
  // segment-overlap-counts.ts. Never `snapshot_ts = NULL`.
  const tsPredicate =
    snapshotTs === null ? 'snapshot_ts IS NULL' : `snapshot_ts = TIMESTAMP ${toSqlLiteral(snapshotTs)}`;
  const keyset = lastUid ? `AND uid > ${toSqlLiteral(lastUid)} ` : '';

  const pageRows = await query(
    `SELECT uid FROM ${SEGMENT_MEMBERSHIP_DAILY} ` +
      `WHERE segment_id = ${segLit} AND game_id = ${gameLit} ` +
      `AND snapshot_date = DATE ${toSqlLiteral(snapshotDate)} ` +
      `AND ${tsPredicate} ${keyset}` +
      `ORDER BY uid ASC LIMIT ${limit}`,
  );
  const uids = pageRows.map((r) => String(r[0]));
  const hasMore = uids.length === limit;
  const thisPageIndex = token?.pageIndex ?? 0;

  return {
    uids,
    // Server-side, constant across pages — the canonical cohort size the rest of
    // the app trusts (mirrors the tokenless route). Never sourced from the token.
    total_count: Number(segment.uid_count ?? 0),
    has_more: hasMore,
    snapshotTs,
    pageIndex: thisPageIndex,
    next_page_id: hasMore
      ? encodePageToken({
          v: 1,
          source: 'daily',
          segmentId: segment.id,
          snapshotDate,
          snapshotTs,
          lastUid: uids[uids.length - 1],
          pageIndex: thisPageIndex + 1,
        })
      : null,
  };
}
