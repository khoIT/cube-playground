/**
 * Shared builder for the segment Care tab payload.
 *
 * The heavy cross-catalog Trino work (CS-ticket history + directional recharge
 * impact strip) lives here so the HTTP route AND the nightly precompute job
 * call ONE function (DRY) and both persist to the same durable cache. The
 * route handles auth/eligibility/caching; this module is pure compute.
 *
 * CS history is the core read — its failure throws (caller decides 502 vs
 * serve-stale). The recharge impact strip degrades to null on Trino trouble so
 * the overlay still renders without it.
 */

import { csProductId } from '../lakehouse/cs-product-map.js';
import {
  fetchCsTickets,
  summarizeCsTickets,
  type CsPulse,
  type CsIssueMixEntry,
} from '../lakehouse/cs-ticket-reader.js';
import {
  readRechargeAroundAnchors,
  summarizeCohortRecharge,
  DEFAULT_WINDOW_DAYS,
  type CohortRechargeStats,
} from '../lakehouse/cs-recharge-trajectory.js';
import type { MemberProfiles } from '../types/segment.js';
import {
  resolveMemberInfo,
  buildWatchlist,
  indexTicketsByUid,
  medianDate,
  type WatchlistEntry,
} from '../routes/segment-cs-care-assembly.js';
import { resolveMemberNamesLive } from './resolve-member-names-live.js';

/** History lookback — wide enough to anchor a ±30d recharge window with margin. */
export const LOOKBACK_DAYS = 365;
/** Whale segments are small; cap defensively so a giant cohort can't blow up the IN-list. */
export const MAX_MEMBER_UIDS = 5000;
/** Cap the non-contacted recharge comparison cohort (sampled). */
const MAX_NONCONTACTED = 200;
/** Below this per-cohort n the impact strip is flagged directional-only. */
const SMALL_SAMPLE_THRESHOLD = 30;
const WATCHLIST_LIMIT = 50;

/** Attached only when the route serves a previously-good payload after a fresh
 *  recompute failed (serve-stale-on-error). Absent on a normal warm/fresh hit. */
export interface CareStaleMeta {
  /** ISO of the last successful build. */
  computedAt: string;
  /** Age of the served payload in ms. */
  ageMs: number;
  /** The recompute failure message that triggered the fallback. */
  reason: string;
}

export interface CsCarePayload {
  segmentId: string;
  gameId: string;
  productId: number;
  coverage: { totalMembers: number; contactedMembers: number; pct: number | null; truncated: boolean };
  freshness: { csMaxLogDate: string | null };
  pulse: CsPulse;
  issueMix: CsIssueMixEntry[];
  watchlist: WatchlistEntry[];
  csImpact: {
    contacted: CohortRechargeStats;
    nonContacted: CohortRechargeStats;
    windowDays: number;
    smallSample: boolean;
  } | null;
  /** Present only when this is a stale-on-error fallback (see CareStaleMeta). */
  stale?: CareStaleMeta;
}

/** Minimal segment row the builder needs (subset of the segments table).
 *  Fields are optional `unknown` so a raw SegmentRow (Record<string, unknown>)
 *  assigns directly; the builder coerces id/game_id to string and validates. */
export interface CareBuildRow {
  id?: unknown;
  game_id?: unknown;
  cube?: unknown;
  workspace?: unknown;
  uid_list_json?: unknown;
  member_profiles_json?: unknown;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function parseProfiles(raw: unknown): MemberProfiles | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as MemberProfiles;
    return Array.isArray(parsed?.rows) ? parsed : null;
  } catch {
    return null;
  }
}

function parseUids(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? [...new Set((parsed as unknown[]).map(String))] : [];
  } catch {
    return [];
  }
}

/** Build-time options. `readTimeoutMs` overrides the per-statement Trino
 *  timeout for the underlying CS-ticket + recharge reads — the interactive
 *  route omits it (fast default); the background precompute path passes a
 *  larger budget so a cold warehouse can complete the heavy join once. */
export interface BuildCsCareOptions {
  readTimeoutMs?: number;
}

/**
 * Build the full Care payload for a segment. Caller must have verified the
 * segment is a CS-covered predicate segment (csProductId returns non-null).
 * Throws if CS ticket history is unavailable.
 */
export async function buildCsCarePayload(row: CareBuildRow, opts: BuildCsCareOptions = {}): Promise<CsCarePayload> {
  const id = String(row.id);
  const gameId = String(row.game_id);
  const productId = csProductId(gameId);
  if (productId == null) {
    throw new Error(`Game '${gameId}' has no CS product mapping`);
  }

  // Resolve members from the refresh-time snapshot (no per-request Cube cost).
  const allUids = parseUids(row.uid_list_json);
  const uids = allUids.slice(0, MAX_MEMBER_UIDS);
  const memberInfo = resolveMemberInfo(parseProfiles(row.member_profiles_json));
  const sinceDate = isoDaysAgo(LOOKBACK_DAYS);
  const asOf = isoDaysAgo(0);

  const rows = await fetchCsTickets({ productId, uids, sinceDate, timeoutMs: opts.readTimeoutMs });
  const { pulse, issueMix } = summarizeCsTickets(rows);
  const watchlist = buildWatchlist(rows, memberInfo, asOf).slice(0, WATCHLIST_LIMIT);

  // Many contacted members rank below the stored top-1000 profile snapshot, so
  // resolveMemberInfo found no name for them. Resolve names for just the
  // displayed rows via one bounded identity-IN query; fail-soft (keeps uid).
  const missingName = watchlist.filter((w) => !w.name).map((w) => w.uid);
  if (missingName.length > 0) {
    const liveNames = await resolveMemberNamesLive(
      { id, cube: typeof row.cube === 'string' ? row.cube : null, game_id: gameId, workspace: String(row.workspace) },
      missingName,
    );
    for (const w of watchlist) {
      if (!w.name && liveNames.has(w.uid)) w.name = liveNames.get(w.uid) ?? null;
    }
  }

  const csImpact = await computeCsImpact(gameId, uids, rows, opts.readTimeoutMs);

  return {
    segmentId: id,
    gameId,
    productId,
    coverage: {
      totalMembers: uids.length,
      contactedMembers: pulse.contacted,
      pct: uids.length > 0 ? (pulse.contacted / uids.length) * 100 : null,
      truncated: allUids.length > uids.length,
    },
    freshness: { csMaxLogDate: rows.reduce<string | null>((m, r) => (m && m > r.logDate ? m : r.logDate), null) },
    pulse,
    issueMix,
    watchlist,
    csImpact,
  };
}

/**
 * Directional recharge impact: contacted members anchored to their first ticket
 * date vs a sampled non-contacted cohort anchored to the median ticket date.
 * Degrades to null (not a throw) when the recharge warehouse is unavailable —
 * the CS overlay still renders without the impact strip.
 */
async function computeCsImpact(
  gameId: string,
  uids: string[],
  rows: import('../lakehouse/cs-ticket-reader.js').CsTicketRow[],
  readTimeoutMs?: number,
): Promise<CsCarePayload['csImpact']> {
  try {
    const indexed = indexTicketsByUid(rows);
    const contactedAnchors = [...indexed.entries()].map(([uid, t]) => ({ uid, anchor: t.firstDate }));
    if (contactedAnchors.length === 0) return null;

    const median = medianDate(contactedAnchors.map((a) => a.anchor));
    if (!median) return null;
    const contactedSet = new Set(indexed.keys());
    // Comparison cohort: non-contacted members, capped. uid_list is rank-ordered
    // by the segment's defining measure, so this samples the top of the cohort —
    // acceptable for a directional/small-sample strip, never a causal claim.
    const nonContactedAnchors = uids
      .filter((u) => !contactedSet.has(u))
      .slice(0, MAX_NONCONTACTED)
      .map((uid) => ({ uid, anchor: median }));

    const [contactedSums, nonContactedSums] = await Promise.all([
      readRechargeAroundAnchors({ gameId, anchors: contactedAnchors, timeoutMs: readTimeoutMs }),
      nonContactedAnchors.length > 0
        ? readRechargeAroundAnchors({ gameId, anchors: nonContactedAnchors, timeoutMs: readTimeoutMs })
        : Promise.resolve([]),
    ]);

    const contacted = summarizeCohortRecharge(contactedSums);
    const nonContacted = summarizeCohortRecharge(nonContactedSums);
    return {
      contacted,
      nonContacted,
      windowDays: DEFAULT_WINDOW_DAYS,
      smallSample: Math.min(contacted.n, nonContacted.n || contacted.n) < SMALL_SAMPLE_THRESHOLD,
    };
  } catch {
    return null;
  }
}
