/**
 * Per-member CS-ticket detail route — GET /api/segments/:id/members/:uid/cs-tickets
 *
 * Backs both the Care-watchlist row-expand (client picks the summary subset) and
 * the Care History 360 page (full transcript). Returns one member's full ticket
 * history off `iceberg.cs_ticket`: conversation threads, ratings, AI labels,
 * sentiment trajectory, reopen/latency, the account-security flag, and the CS-side
 * VIP profile.
 *
 * Auth: `guardSegment(read)` authorizes the SEGMENT; we ADDITIONALLY assert the
 * uid is a member (in the refresh-time snapshot) so a readable segment can't be
 * used as an arbitrary-uid CS-transcript lookup. CS history is the core read
 * (failure → 502); coverage is partial by design (Ingame/Web/Phone only) and a
 * non-joining/quiet member returns 200 with an empty list, not 404.
 */

import type { FastifyInstance } from 'fastify';
import { guardSegment } from './segments.js';
import { hasCsCoverage, csProductId } from '../lakehouse/cs-product-map.js';
import { fetchCsTicketDetail, DEFAULT_DETAIL_CAPS } from '../lakehouse/cs-ticket-detail-reader.js';
import type { CsTicketDetail } from '../lakehouse/cs-ticket-detail-types.js';
import { resolveMemberInfo } from './segment-cs-care-assembly.js';
import {
  readRechargeAroundAnchors,
  summarizeCohortRecharge,
  DEFAULT_WINDOW_DAYS,
  type CohortRechargeStats,
} from '../lakehouse/cs-recharge-trajectory.js';
import type { MemberProfiles } from '../types/segment.js';

const CACHE_TTL_MS = 6 * 60 * 60_000; // 6h — CS data is next-day fresh
const MAX_CACHE_ENTRIES = 500;
const LOOKBACK_DAYS = 365;
/** uids in our store are alphanumeric ids; reject anything else (defense-in-depth). */
const UID_RE = /^[A-Za-z0-9_-]+$/;

export interface CsTicketsPayload {
  segmentId: string;
  gameId: string;
  productId: number;
  uid: string;
  /** Identity decoration from the segment's ranked member snapshot (best-effort). */
  member: { name: string | null; ltv: number | null };
  coverage: { joined: boolean; note: string | null };
  freshness: { csMaxLogDate: string | null };
  /** Pre/post recharge around the member's first CS contact; null when the
   *  recharge warehouse is unavailable (degrades, does not fail the endpoint). */
  recharge: (CohortRechargeStats & { windowDays: number }) | null;
  tickets: CsTicketDetail[];
}

const cache = new Map<string, { at: number; payload: CsTicketsPayload }>();

/** Test hook — clears the route cache. */
export function __clearCsTicketsCache(): void {
  cache.clear();
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Parse the segment's refresh-time member uid snapshot. Mirrors segment-cs-care. */
function parseUids(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? [...new Set((parsed as unknown[]).map(String))] : [];
  } catch {
    return [];
  }
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

/**
 * Pre/post recharge around the member's earliest CS contact. Degrades to null
 * (never throws) so a recharge-warehouse hiccup can't fail the transcript read.
 */
async function computeMemberRecharge(
  gameId: string,
  uid: string,
  tickets: CsTicketDetail[],
): Promise<CsTicketsPayload['recharge']> {
  if (tickets.length === 0) return null;
  try {
    const firstDate = tickets.reduce((m, t) => (t.openedAt < m ? t.openedAt : m), tickets[0].openedAt);
    const sums = await readRechargeAroundAnchors({ gameId, anchors: [{ uid, anchor: firstDate }] });
    return { ...summarizeCohortRecharge(sums), windowDays: DEFAULT_WINDOW_DAYS };
  } catch {
    return null;
  }
}

export default async function segmentCsTicketsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/segments/:id/members/:uid/cs-tickets', async (req, reply) => {
    const { id, uid } = req.params as { id: string; uid: string };
    const row = guardSegment(req, reply, id, 'read');
    if (!row) return reply;

    const gameId = typeof row.game_id === 'string' ? row.game_id : null;
    const productId = gameId ? csProductId(gameId) : null;
    if (row.type !== 'predicate' || !gameId || !hasCsCoverage(gameId) || productId == null) {
      return reply.status(404).send({
        error: { code: 'NO_CS_CARE', message: 'CS care exists only for predicate segments of games with CS coverage' },
      });
    }

    if (!UID_RE.test(uid)) {
      return reply.status(400).send({ error: { code: 'BAD_UID', message: 'Invalid member uid' } });
    }

    // Membership assertion: the uid MUST belong to this segment. guardSegment
    // authorizes the segment, not arbitrary members — without this, any readable
    // segment is a lookup tool for any player's CS transcript.
    if (!parseUids(row.uid_list_json).includes(uid)) {
      return reply.status(404).send({ error: { code: 'NOT_IN_SEGMENT', message: 'Member is not in this segment' } });
    }

    const cacheKey = `${id}::${uid}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload;

    let payload: CsTicketsPayload;
    try {
      const all = await fetchCsTicketDetail({ productId, uid, sinceDate: isoDaysAgo(LOOKBACK_DAYS) });
      // Reader already caps messages/ratings per ticket via SQL window; re-assert
      // the ticket cap here as a defensive bound on payload size.
      const tickets = all.slice(0, DEFAULT_DETAIL_CAPS.maxTickets);
      const joined = tickets.length > 0;
      const member = resolveMemberInfo(parseProfiles(row.member_profiles_json)).get(uid) ?? { name: null, ltv: null };
      const recharge = await computeMemberRecharge(gameId, uid, tickets);
      payload = {
        segmentId: id,
        gameId,
        productId,
        uid,
        member,
        recharge,
        coverage: {
          joined,
          note: joined
            ? null
            : 'No joinable CS history — this member has no Ingame/Web/Phone tickets (Facebook/AIHelp tickets are unjoinable).',
        },
        freshness: {
          csMaxLogDate: tickets.reduce<string | null>((m, t) => (m && m > t.openedAt ? m : t.openedAt), null),
        },
        tickets,
      };
    } catch (err) {
      return reply.status(502).send({
        error: { code: 'CS_TICKETS_UNAVAILABLE', message: (err as Error).message },
      });
    }

    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(cacheKey, { at: Date.now(), payload });
    return payload;
  });
}
