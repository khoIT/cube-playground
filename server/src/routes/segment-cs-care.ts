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

/** Test hook — clears the durable care cache (kept name so existing tests pass). */
export function __clearCsCareCache(): void {
  __clearCareCache();
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
