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
import { resolvePayingCohortContext, resolveRankedPayingUids } from './segment-cohort-context.js';
import type { SegmentRow } from '../routes/segments.js';

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

/** Outcome of one underlying Trino read inside a Care build.
 *  - ok        : completed, `rows` populated
 *  - timeout   : statement-timeout (the read exceeded its budget)
 *  - error     : other failure (`error` carries the message)
 *  - degraded  : failed but the build continued without it (impact strip only)
 *  - skipped   : not run (e.g. no contacted members to anchor recharge on) */
export type CareStageStatus = 'ok' | 'timeout' | 'error' | 'degraded' | 'skipped';

export interface CareStage {
  /** Stable read name: cs-tickets | name-resolve | recharge-contacted | recharge-noncontacted */
  name: string;
  status: CareStageStatus;
  elapsedMs: number;
  /** Row count for an ok read, when meaningful. */
  rows?: number;
  /** Failure message for timeout/error/degraded. */
  error?: string;
}

/** Classify a thrown read as a statement-timeout vs a generic failure. */
function isTimeout(err: unknown): boolean {
  return /timed out|timeout/i.test((err as Error)?.message ?? '');
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
  /** Optional sink the builder appends per-read telemetry to (see CareStage).
   *  The background precompute path passes one so a failed/slow pass records
   *  WHICH Trino read was at fault, even when the build throws. */
  stages?: CareStage[];
  /** "Paying users only" sub-scope. When set, members are resolved LIVE as the
   *  payer sub-cohort (segment predicate ∩ paying_lifetime, ranked by the
   *  segment's measure, capped) instead of the full-cohort uid_list snapshot —
   *  the snapshot carries no per-uid LTV, so it can't be paying-filtered. The
   *  caller MUST pass the segment row so the live cohort context can be
   *  resolved; a missing/non-mf_users row falls back to the snapshot uids. */
  payingOnly?: boolean;
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

  // Resolve members: full-cohort from the refresh-time snapshot (no per-request
  // Cube cost), OR — under the "paying users only" sub-scope — the payer
  // sub-cohort resolved LIVE (the snapshot has no per-uid LTV to filter on).
  // `truncated` means the cohort was capped before the CS join: in snapshot
  // mode that's snapshot-size > cap; in paying mode the live pull hit the cap
  // (more payers may exist beyond it).
  const snapshotUids = parseUids(row.uid_list_json);
  let uids: string[];
  let truncated: boolean;
  if (opts.payingOnly) {
    const ctx = await resolvePayingCohortContext(row as unknown as SegmentRow);
    const payingUids = ctx ? await resolveRankedPayingUids(ctx, MAX_MEMBER_UIDS) : null;
    // No mf_users hub (ctx null) → the sub-scope doesn't apply; degrade to the
    // full snapshot rather than blanking Care.
    uids = payingUids ?? snapshotUids.slice(0, MAX_MEMBER_UIDS);
    truncated = payingUids ? payingUids.length >= MAX_MEMBER_UIDS : snapshotUids.length > uids.length;
  } else {
    uids = snapshotUids.slice(0, MAX_MEMBER_UIDS);
    truncated = snapshotUids.length > uids.length;
  }
  const memberInfo = resolveMemberInfo(parseProfiles(row.member_profiles_json));
  const sinceDate = isoDaysAgo(LOOKBACK_DAYS);
  const asOf = isoDaysAgo(0);

  const sink = opts.stages;

  // CS-ticket history is the core cross-catalog join — the heavy read and the
  // one whose failure fails the whole build. Record it, then rethrow.
  const tTickets = Date.now();
  let rows: import('../lakehouse/cs-ticket-reader.js').CsTicketRow[];
  try {
    rows = await fetchCsTickets({ productId, uids, sinceDate, timeoutMs: opts.readTimeoutMs });
    sink?.push({ name: 'cs-tickets', status: 'ok', elapsedMs: Date.now() - tTickets, rows: rows.length });
  } catch (err) {
    sink?.push({
      name: 'cs-tickets',
      status: isTimeout(err) ? 'timeout' : 'error',
      elapsedMs: Date.now() - tTickets,
      error: (err as Error).message,
    });
    throw err;
  }
  const { pulse, issueMix } = summarizeCsTickets(rows);
  const watchlist = buildWatchlist(rows, memberInfo, asOf).slice(0, WATCHLIST_LIMIT);

  // Many contacted members rank below the stored top-1000 profile snapshot, so
  // resolveMemberInfo found no name for them. Resolve names for just the
  // displayed rows via one bounded identity-IN query.
  const missingName = watchlist.filter((w) => !w.name).map((w) => w.uid);
  if (missingName.length > 0) {
    const tNames = Date.now();
    try {
      const liveNames = await resolveMemberNamesLive(
        { id, cube: typeof row.cube === 'string' ? row.cube : null, game_id: gameId, workspace: String(row.workspace) },
        missingName,
      );
      for (const w of watchlist) {
        if (!w.name && liveNames.has(w.uid)) w.name = liveNames.get(w.uid) ?? null;
      }
      sink?.push({ name: 'name-resolve', status: 'ok', elapsedMs: Date.now() - tNames, rows: missingName.length });
    } catch (err) {
      // Names are cosmetic — degrade (rows keep their uid) rather than fail.
      sink?.push({
        name: 'name-resolve',
        status: 'degraded',
        elapsedMs: Date.now() - tNames,
        error: (err as Error).message,
      });
    }
  } else {
    sink?.push({ name: 'name-resolve', status: 'skipped', elapsedMs: 0 });
  }

  const csImpact = await computeCsImpact(gameId, uids, rows, opts.readTimeoutMs, sink);

  return {
    segmentId: id,
    gameId,
    productId,
    coverage: {
      totalMembers: uids.length,
      contactedMembers: pulse.contacted,
      pct: uids.length > 0 ? (pulse.contacted / uids.length) * 100 : null,
      truncated,
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
  sink?: CareStage[],
): Promise<CsCarePayload['csImpact']> {
  const indexed = indexTicketsByUid(rows);
  const contactedAnchors = [...indexed.entries()].map(([uid, t]) => ({ uid, anchor: t.firstDate }));
  if (contactedAnchors.length === 0) {
    sink?.push({ name: 'recharge-contacted', status: 'skipped', elapsedMs: 0 });
    sink?.push({ name: 'recharge-noncontacted', status: 'skipped', elapsedMs: 0 });
    return null;
  }

  const median = medianDate(contactedAnchors.map((a) => a.anchor));
  if (!median) {
    sink?.push({ name: 'recharge-contacted', status: 'skipped', elapsedMs: 0 });
    sink?.push({ name: 'recharge-noncontacted', status: 'skipped', elapsedMs: 0 });
    return null;
  }
  const contactedSet = new Set(indexed.keys());
  // Comparison cohort: non-contacted members, capped. uid_list is rank-ordered
  // by the segment's defining measure, so this samples the top of the cohort —
  // acceptable for a directional/small-sample strip, never a causal claim.
  const nonContactedAnchors = uids
    .filter((u) => !contactedSet.has(u))
    .slice(0, MAX_NONCONTACTED)
    .map((uid) => ({ uid, anchor: median }));

  // Time each read independently so the board can show which recharge query was
  // slow. The impact strip is non-essential: any read failure degrades the WHOLE
  // strip to null (the overlay still renders), but each read's status is recorded.
  const tC = Date.now();
  let contactedSums: import('../lakehouse/cs-recharge-trajectory.js').RechargeWindowSums[];
  try {
    contactedSums = await readRechargeAroundAnchors({ gameId, anchors: contactedAnchors, timeoutMs: readTimeoutMs });
    sink?.push({ name: 'recharge-contacted', status: 'ok', elapsedMs: Date.now() - tC, rows: contactedSums.length });
  } catch (err) {
    sink?.push({
      name: 'recharge-contacted',
      status: isTimeout(err) ? 'timeout' : 'degraded',
      elapsedMs: Date.now() - tC,
      error: (err as Error).message,
    });
    sink?.push({ name: 'recharge-noncontacted', status: 'skipped', elapsedMs: 0 });
    return null;
  }

  const tN = Date.now();
  let nonContactedSums: import('../lakehouse/cs-recharge-trajectory.js').RechargeWindowSums[] = [];
  if (nonContactedAnchors.length > 0) {
    try {
      nonContactedSums = await readRechargeAroundAnchors({ gameId, anchors: nonContactedAnchors, timeoutMs: readTimeoutMs });
      sink?.push({ name: 'recharge-noncontacted', status: 'ok', elapsedMs: Date.now() - tN, rows: nonContactedSums.length });
    } catch (err) {
      sink?.push({
        name: 'recharge-noncontacted',
        status: isTimeout(err) ? 'timeout' : 'degraded',
        elapsedMs: Date.now() - tN,
        error: (err as Error).message,
      });
      return null;
    }
  } else {
    sink?.push({ name: 'recharge-noncontacted', status: 'skipped', elapsedMs: 0 });
  }

  const contacted = summarizeCohortRecharge(contactedSums);
  const nonContacted = summarizeCohortRecharge(nonContactedSums);
  return {
    contacted,
    nonContacted,
    windowDays: DEFAULT_WINDOW_DAYS,
    smallSample: Math.min(contacted.n, nonContacted.n || contacted.n) < SMALL_SAMPLE_THRESHOLD,
  };
}
