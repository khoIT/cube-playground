/**
 * Segment member-tiers route — GET /api/segments/:id/member-tiers?scope=paying
 *
 * Serves the live "paying users only" Members tiers (top/middle/bottom-50 of the
 * payer sub-cohort). The default ("all") tiers ship inline on the segment detail
 * payload (segment.member_tiers, refresh-time), so this route exists ONLY for the
 * paying sub-scope, which is never precomputed — see segment-paying-tiers.ts.
 *
 * Compute is a handful of ranked Cube reads (cold Trino can take seconds), so a
 * short process-local TTL cache absorbs tab toggles within a session. No durable
 * cache / serve-stale: the sub-scope is an interactive drill-down, and a stale
 * payer ranking is worse than a fresh recompute on the next visit.
 */

import type { FastifyInstance } from 'fastify';
import { guardSegment } from './segments.js';
import { computePayingMemberTiers } from '../services/segment-paying-tiers.js';
import type { MemberTiers } from '../types/segment.js';

const CACHE_TTL_MS = 10 * 60_000; // 10 min — matches the FE live-card cache window

interface CacheEntry {
  tiers: MemberTiers | null;
  at: number;
}
const payingTiersCache = new Map<string, CacheEntry>();

/** Test hook — clears the in-memory paying-tiers cache. */
export function __clearPayingTiersCache(): void {
  payingTiersCache.clear();
}

export default async function segmentMemberTiersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/segments/:id/member-tiers', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { scope } = req.query as { scope?: string };
    const row = guardSegment(req, reply, id, 'read');
    if (!row) return reply;

    // Only the paying sub-scope is served live; "all" lives on the detail payload.
    if (scope !== 'paying') {
      return reply.status(400).send({
        error: { code: 'UNSUPPORTED_SCOPE', message: 'Only scope=paying is served live; default tiers ship inline.' },
      });
    }

    const cached = payingTiersCache.get(id);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return { tiers: cached.tiers };

    try {
      const tiers = await computePayingMemberTiers(row);
      payingTiersCache.set(id, { tiers, at: Date.now() });
      return { tiers };
    } catch (err) {
      return reply.status(502).send({
        error: { code: 'PAYING_TIERS_UNAVAILABLE', message: (err as Error).message },
      });
    }
  });
}
