/**
 * Segment CS-care route — GET /api/segments/:id/cs-care
 *
 * Overlays customer-support history onto a segment's members (Direction A: a
 * CS-lead view of which whales are contacting support, about what, and how
 * unhappy) plus a directional contacted-vs-not recharge strip (Direction B).
 *
 * The heavy cross-catalog Trino compute lives in cs-care-builder.ts (shared
 * with the nightly precompute job). This route handles auth/eligibility and a
 * DURABLE cache (segment_care_cache):
 *   - warm hit within TTL → served instantly, zero Trino cost.
 *   - cold miss → compute synchronously once, persist, serve.
 *   - compute throws but a last-good payload exists → serve stale (200 +
 *     `stale` breadcrumb) instead of failing the tab.
 *   - compute throws and nothing was ever cached → 502.
 *
 * Coverage is partial by design (~in-game/web/phone only); the payload reports
 * contacted/total honestly and never implies full coverage.
 */

import type { FastifyInstance } from 'fastify';
import { guardSegment } from './segments.js';
import { hasCsCoverage, csProductId } from '../lakehouse/cs-product-map.js';
import { buildCsCarePayload, type CsCarePayload, type CareStaleMeta } from '../services/cs-care-builder.js';
import {
  readCareCache,
  writeCareCache,
  markCareAttempt,
  __clearCareCache,
} from '../db/segment-care-cache-store.js';

export type { CsCarePayload };

const CACHE_TTL_MS = 6 * 60 * 60_000; // 6h — CS data is next-day fresh

/** "Paying users only" sub-scope cache — process-local, not durable. The payer
 *  sub-cohort is resolved live and is never precomputed by the nightly job, so
 *  it can't share the durable segment_care_cache (keyed by segment id, written
 *  by the precompute path). Same TTL/serve-stale-on-error contract, in memory. */
interface PayingCareEntry {
  payload: CsCarePayload;
  computedAt: number;
}
const payingCareCache = new Map<string, PayingCareEntry>();

/** Test hook — clears both the durable care cache and the paying sub-cache. */
export function __clearCsCareCache(): void {
  __clearCareCache();
  payingCareCache.clear();
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

    const { scope } = req.query as { scope?: string };
    const payingOnly = scope === 'paying';

    // Paying sub-scope: process-local cache, live payer sub-cohort.
    if (payingOnly) {
      const warm = payingCareCache.get(id);
      if (warm && Date.now() - warm.computedAt < CACHE_TTL_MS) return warm.payload;
      try {
        const payload = await buildCsCarePayload(row, { payingOnly: true });
        payingCareCache.set(id, { payload, computedAt: Date.now() });
        return payload;
      } catch (err) {
        const message = (err as Error).message;
        if (warm) {
          const stale: CareStaleMeta = { computedAt: new Date(warm.computedAt).toISOString(), ageMs: Date.now() - warm.computedAt, reason: message };
          return { ...warm.payload, stale };
        }
        return reply.status(502).send({ error: { code: 'CS_CARE_UNAVAILABLE', message } });
      }
    }

    // Warm hit: a recently-built payload — serve it without touching Trino.
    const cached = readCareCache(id);
    if (cached && cached.ageMs < CACHE_TTL_MS) return cached.payload;

    try {
      const payload = await buildCsCarePayload(row);
      writeCareCache(id, gameId, payload);
      return payload;
    } catch (err) {
      const message = (err as Error).message;
      markCareAttempt(id, gameId, message);

      // Serve-stale-on-error: a transient Trino failure must not blank the tab
      // when we have a previously-good payload. Return it with a `stale`
      // breadcrumb (the UI shows an "as of HH:MM" freshness badge).
      if (cached) {
        const stale: CareStaleMeta = { computedAt: cached.computedAt, ageMs: cached.ageMs, reason: message };
        return { ...cached.payload, stale };
      }

      // True cold miss with no fallback — fail honestly.
      return reply.status(502).send({
        error: { code: 'CS_CARE_UNAVAILABLE', message },
      });
    }
  });
}
