/**
 * Opaque `page_id` codec for the segment members paginated pull.
 *
 * A page token is the ONLY state carried between pages: it pins which cohort
 * snapshot a pull is walking (so page N belongs to the same point-in-time as
 * page 1) and where the uid keyset left off. It is base64url(JSON) — opaque to
 * the consumer, but NOT a security token: re-pointing it at another segment is
 * defended by the reader rejecting a token whose `segmentId` ≠ the request path
 * `:id` (the path is already scope-checked), so no HMAC is needed.
 *
 * Fields:
 *   v          schema version (only 1 today; a future bump can migrate)
 *   source     'daily'  → Iceberg segment_membership_daily partition (predicate)
 *              'manual' → the segment's stored uid_list_json
 *   segmentId  the segment this token walks — MUST match the request path
 *   snapshotDate / snapshotTs  the pinned daily partition (daily source only;
 *              snapshotTs is null for legacy rows captured before sub-daily ts)
 *   lastUid    the last uid returned on the previous page (keyset cursor); '' is
 *              never encoded — page 1 carries no token at all
 */

/** Thrown when a supplied `page_id` is malformed or points at the wrong segment.
 *  The route maps this to 400. */
export class InvalidPageTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPageTokenError';
  }
}

export type PageSource = 'daily' | 'manual';

export interface PageToken {
  v: 1;
  source: PageSource;
  segmentId: string;
  /** Pinned partition date 'YYYY-MM-DD' (daily source only). */
  snapshotDate?: string;
  /** Pinned partition ts (daily source only); null = legacy NULL-ts partition. */
  snapshotTs?: string | null;
  /** Keyset cursor — last uid of the previous page. */
  lastUid: string;
}

/** Encode page state into an opaque base64url token. */
export function encodePageToken(token: PageToken): string {
  return Buffer.from(JSON.stringify(token), 'utf8').toString('base64url');
}

/** Decode + validate a page token. Throws InvalidPageTokenError on any defect. */
export function decodePageToken(raw: string): PageToken {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidPageTokenError('page_id is not a valid token');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidPageTokenError('page_id payload is not an object');
  }
  const t = parsed as Record<string, unknown>;
  if (t.v !== 1) throw new InvalidPageTokenError('unsupported page_id version');
  if (t.source !== 'daily' && t.source !== 'manual') {
    throw new InvalidPageTokenError('page_id has an unknown source');
  }
  if (typeof t.segmentId !== 'string' || t.segmentId.length === 0) {
    throw new InvalidPageTokenError('page_id is missing segmentId');
  }
  if (typeof t.lastUid !== 'string') {
    throw new InvalidPageTokenError('page_id is missing lastUid');
  }
  if (t.snapshotDate !== undefined && typeof t.snapshotDate !== 'string') {
    throw new InvalidPageTokenError('page_id snapshotDate is malformed');
  }
  if (t.snapshotTs !== undefined && t.snapshotTs !== null && typeof t.snapshotTs !== 'string') {
    throw new InvalidPageTokenError('page_id snapshotTs is malformed');
  }
  return {
    v: 1,
    source: t.source,
    segmentId: t.segmentId,
    snapshotDate: t.snapshotDate as string | undefined,
    snapshotTs: t.snapshotTs as string | null | undefined,
    lastUid: t.lastUid,
  };
}
