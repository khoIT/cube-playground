/**
 * Resolve the real cohort facts for an experiment Target from what the platform
 * already knows about a segment — so the draft's addressable N and reachable %
 * are grounded, not hand-typed defaults.
 *
 *   addressableN ← the segment's last-refreshed uid_count
 *   reachablePct ← the segment's CS Care coverage (the fraction we can actually
 *                  reach through the CS-actuated channel the levers use)
 *
 * Both return null when the fact isn't known yet; callers keep their explicit
 * value or fall back to an honest default. Pure reads — never throw.
 */

import { getDb } from '../db/sqlite.js';
import { readCareCache } from '../db/segment-care-cache-store.js';

/** Addressable cohort size from the segment's last refresh, or null if unknown/empty. */
export function resolveAddressableN(segmentId: string): number | null {
  const row = getDb()
    .prepare('SELECT uid_count FROM segments WHERE id = ?')
    .get(segmentId) as { uid_count: number } | undefined;
  return row && typeof row.uid_count === 'number' && row.uid_count > 0 ? row.uid_count : null;
}

/**
 * Reachable fraction (0–1) from the segment's CS Care coverage — i.e. the share
 * of members the CS team can actually contact. Null when no Care snapshot exists.
 */
export function resolveReachablePct(segmentId: string): number | null {
  const pct = readCareCache(segmentId)?.payload.coverage.pct;
  return typeof pct === 'number' && pct > 0 ? Math.min(1, pct / 100) : null;
}
