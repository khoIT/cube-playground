/**
 * Segment CS-care route — GET /api/segments/:id/cs-care
 *
 * Overlays customer-support history onto a segment's members (Direction A: a
 * CS-lead view of which whales are contacting support, about what, and how
 * unhappy) plus a directional contacted-vs-not recharge strip (Direction B).
 *
 * Coverage is partial by design (~in-game/web/phone only); the payload reports
 * contacted/total honestly and never implies full coverage. CS history is the
 * core read (failure → 502); the recharge impact strip degrades to null on
 * Trino trouble rather than failing the whole tab. TTL-cached like trajectory.
 */

import type { FastifyInstance } from 'fastify';
import { guardSegment } from './segments.js';
import { hasCsCoverage, csProductId } from '../lakehouse/cs-product-map.js';
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
} from './segment-cs-care-assembly.js';

const CACHE_TTL_MS = 6 * 60 * 60_000; // 6h — CS data is next-day fresh
const MAX_CACHE_ENTRIES = 300;
/** History lookback — wide enough to anchor a ±30d recharge window with margin. */
const LOOKBACK_DAYS = 365;
/** Whale segments are small; cap defensively so a giant cohort can't blow up the IN-list. */
const MAX_MEMBER_UIDS = 5000;
/** Cap the non-contacted recharge comparison cohort (sampled). */
const MAX_NONCONTACTED = 200;
/** Below this per-cohort n the impact strip is flagged directional-only. */
const SMALL_SAMPLE_THRESHOLD = 30;
const WATCHLIST_LIMIT = 50;

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
}

const cache = new Map<string, { at: number; payload: CsCarePayload }>();

/** Test hook — clears the route cache. */
export function __clearCsCareCache(): void {
  cache.clear();
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

export default async function segmentCsCareRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/segments/:id/cs-care', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = guardSegment(req, reply, id, 'read');
    if (!row) return reply;

    const gameId = typeof row.game_id === 'string' ? row.game_id : null;
    const productId = gameId ? csProductId(gameId) : null;
    if (row.type !== 'predicate' || !gameId || !hasCsCoverage(gameId) || productId == null) {
      return reply.status(404).send({
        error: { code: 'NO_CS_CARE', message: 'CS care exists only for predicate segments of games with CS coverage' },
      });
    }

    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload;

    // Resolve members from the refresh-time snapshot (no per-request Cube cost).
    const allUids = parseUids(row.uid_list_json);
    const uids = allUids.slice(0, MAX_MEMBER_UIDS);
    const memberInfo = resolveMemberInfo(parseProfiles(row.member_profiles_json));
    const sinceDate = isoDaysAgo(LOOKBACK_DAYS);
    const asOf = isoDaysAgo(0);

    let payload: CsCarePayload;
    try {
      const rows = await fetchCsTickets({ productId, uids, sinceDate });
      const { pulse, issueMix } = summarizeCsTickets(rows);
      const watchlist = buildWatchlist(rows, memberInfo, asOf).slice(0, WATCHLIST_LIMIT);

      const csImpact = await computeCsImpact(gameId, uids, rows);

      payload = {
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
    } catch (err) {
      return reply.status(502).send({
        error: { code: 'CS_CARE_UNAVAILABLE', message: (err as Error).message },
      });
    }

    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(id, { at: Date.now(), payload });
    return payload;
  });
}

/**
 * Directional recharge impact: contacted members anchored to their first ticket
 * date vs a sampled non-contacted cohort anchored to the median ticket date.
 * Degrades to null (not a 502) when the recharge warehouse is unavailable —
 * the CS overlay still renders without the impact strip.
 */
async function computeCsImpact(
  gameId: string,
  uids: string[],
  rows: import('../lakehouse/cs-ticket-reader.js').CsTicketRow[],
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
      readRechargeAroundAnchors({ gameId, anchors: contactedAnchors }),
      nonContactedAnchors.length > 0
        ? readRechargeAroundAnchors({ gameId, anchors: nonContactedAnchors })
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
