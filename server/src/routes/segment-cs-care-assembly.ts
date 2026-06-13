/**
 * Pure assembly helpers for the segment CS-care payload — member resolution,
 * watchlist + risk scoring, and impact-cohort selection. Kept Trino-free so the
 * scoring/ordering math is unit-testable over fixtures; the route module owns
 * the I/O (guard, fetch, cache).
 */

import type { CsTicketRow } from '../lakehouse/cs-ticket-reader.js';
import type { MemberProfiles } from '../types/segment.js';

export interface MemberInfo {
  name: string | null;
  ltv: number | null;
}

export interface WatchlistEntry {
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

/** Category families that escalate risk (whales hitting these need outreach). */
const HIGH_STAKES_CATEGORY = /payment|security|account|fraud|refund|hack|ban/i;
const RESOLVED_STATUS = new Set(['Closed', 'Rejected']);

/**
 * Build uid → {name, ltv} from a ranked member-profile snapshot. Column keys
 * vary by game/preset, so name/ltv are resolved heuristically and best-effort
 * (decoration only — absence never blocks the CS overlay).
 */
export function resolveMemberInfo(profiles: MemberProfiles | null): Map<string, MemberInfo> {
  const out = new Map<string, MemberInfo>();
  if (!profiles?.rows?.length) return out;
  const cols = profiles.columns ?? [];
  const match = (re: RegExp): string | null => {
    const c = cols.find((col) => re.test(col.key) || re.test(col.field));
    return c ? c.key : null;
  };
  // Prefer an in-game name, then any name-ish column.
  const nameKey = match(/ingame.?name|player.?name|display.?name/i) ?? match(/name/i);
  const ltvKey = match(/ltv/i) ?? match(/recharge|revenue|value|spend/i);

  for (const row of profiles.rows) {
    const uid = String(row.uid);
    const name = nameKey != null && row[nameKey] != null ? String(row[nameKey]) : null;
    // Guard null/undefined before Number() — Number(null) is 0, which would
    // fabricate a zero LTV (and skew the watchlist's LTV rank) for unranked members.
    const ltvRaw = ltvKey != null && row[ltvKey] != null ? Number(row[ltvKey]) : NaN;
    out.set(uid, { name, ltv: Number.isFinite(ltvRaw) ? ltvRaw : null });
  }
  return out;
}

/** Latest (and earliest) ticket per uid from a row list sorted however. */
export function indexTicketsByUid(rows: CsTicketRow[]): Map<
  string,
  { latest: CsTicketRow; firstDate: string }
> {
  const byUid = new Map<string, { latest: CsTicketRow; firstDate: string }>();
  for (const row of rows) {
    const cur = byUid.get(row.uid);
    if (!cur) {
      byUid.set(row.uid, { latest: row, firstDate: row.logDate });
      continue;
    }
    if (row.logDate > cur.latest.logDate) cur.latest = row;
    if (row.logDate < cur.firstDate) cur.firstDate = row.logDate;
  }
  return byUid;
}

function daysBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

/**
 * Risk score from a member's latest ticket + LTV rank. Weighted so a whale with
 * a negative, low-rated, still-open payment ticket floats to the top. LTV rank
 * is a fraction (0..1) of standing within the contacted cohort.
 */
export function riskScore(latest: CsTicketRow, ltvRankFraction: number): number {
  let score = 0;
  if (latest.sentiment === 'Negative') score += 40;
  if (latest.rating != null && latest.rating <= 2) score += 25;
  if (latest.statusGroup && !RESOLVED_STATUS.has(latest.statusGroup)) score += 20;
  if (latest.labelCategory && HIGH_STAKES_CATEGORY.test(latest.labelCategory)) score += 10;
  score += Math.round(ltvRankFraction * 15);
  return score;
}

/**
 * Build the risk-sorted watchlist for contacted members. `asOf` anchors the
 * days-since computation (defaults supplied by the route as today).
 */
export function buildWatchlist(
  rows: CsTicketRow[],
  memberInfo: Map<string, MemberInfo>,
  asOf: string,
): WatchlistEntry[] {
  const indexed = indexTicketsByUid(rows);

  // LTV-desc ranking across contacted members for the rank-fraction weight.
  const contacted = [...indexed.keys()];
  const byLtv = [...contacted].sort(
    (a, b) => (memberInfo.get(b)?.ltv ?? 0) - (memberInfo.get(a)?.ltv ?? 0),
  );
  const rankFraction = new Map<string, number>();
  const denom = Math.max(byLtv.length - 1, 1);
  byLtv.forEach((uid, i) => rankFraction.set(uid, 1 - i / denom));

  const entries: WatchlistEntry[] = contacted.map((uid) => {
    const { latest } = indexed.get(uid)!;
    const info = memberInfo.get(uid) ?? { name: null, ltv: null };
    return {
      uid,
      name: info.name,
      ltv: info.ltv,
      lastCategory: latest.labelCategory,
      lastSource: latest.source,
      sentiment: latest.sentiment,
      rating: latest.rating,
      statusGroup: latest.statusGroup,
      daysSince: daysBetween(latest.logDate, asOf),
      riskScore: riskScore(latest, rankFraction.get(uid) ?? 0),
    };
  });

  return entries.sort((a, b) => b.riskScore - a.riskScore || (b.ltv ?? 0) - (a.ltv ?? 0));
}

/** Median of ISO date strings (lower-median for even counts). */
export function medianDate(dates: string[]): string | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
}
