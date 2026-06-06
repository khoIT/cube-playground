/**
 * Member-360 cache-serving routes — read side of the nightly precompute
 * (member360-runner writes, these serve). Split from segments.ts purely for
 * file size; same guard + error-envelope conventions.
 *
 *   GET /api/segments/:id/members/:uid/panels      → cached panel map for one member
 *   GET /api/segments/:id/member-cache-status      → per-uid ok/error aggregate (chips)
 */

import type { FastifyInstance } from 'fastify';
import { guardSegment } from './segments.js';
import {
  getMember360Cache,
  getMember360StatusBySegment,
} from '../services/member360-cache-store.js';
import { corePanelsForGame } from '../services/member360-panel-registry.js';

export default async function segmentMember360Routes(app: FastifyInstance): Promise<void> {
  // Cached core-panel rows for one member. `cached: false` (and an empty map)
  // means the FE should use its live path for everything — same response shape
  // either way so the client never branches on status codes.
  app.get('/api/segments/:id/members/:uid/panels', async (req, reply) => {
    const { id, uid } = req.params as { id: string; uid: string };
    const row = guardSegment(req, reply, id, 'read');
    if (!row) return reply;

    const panels = getMember360Cache(id, uid);
    return {
      segment_id: id,
      uid,
      panels,
      cached: Object.keys(panels).length > 0,
    };
  });

  // Per-uid cache readiness for the Members tab. `panel_count` is the number
  // of core panels the segment's game precomputes, so the FE can classify
  // ok === panel_count → ready, 0 < ok < panel_count → partial, else none.
  app.get('/api/segments/:id/member-cache-status', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = guardSegment(req, reply, id, 'read');
    if (!row) return reply;

    return {
      segment_id: id,
      panel_count: corePanelsForGame(row.game_id as string | null).length,
      uids: getMember360StatusBySegment(id),
    };
  });
}
