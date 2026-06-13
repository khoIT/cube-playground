/**
 * Game → CS warehouse product_id map.
 *
 * The CS ticketing warehouse (`iceberg.cs_ticket`) keys every ticket by a
 * numeric `product_id` (its own product taxonomy in `cs_map_product`), NOT by
 * our game id. Only games we've validated a product_id for can surface CS
 * history, so this map doubles as the coverage gate for the Care tab: a game
 * absent here has no CS overlay.
 *
 * Keys are canonical game ids (see `canonicalGameId`) so country-suffixed
 * aliases (`jus_vn` → `jus`, `cfm_vn` → `cfm`) resolve to the same entry.
 */

import { canonicalGameId } from '../services/trino-profiler-config.js';

/** Canonical game id → CS `product_id`. Extend as more games are validated. */
const CS_PRODUCT_BY_GAME: Record<string, number> = {
  jus: 832,
  cfm: 856,
};

/** CS `product_id` for a game, or null when the game has no CS coverage. */
export function csProductId(gameId: string): number | null {
  return CS_PRODUCT_BY_GAME[canonicalGameId(gameId)] ?? null;
}

/** True when the game has a validated CS product mapping (Care tab gate). */
export function hasCsCoverage(gameId: string): boolean {
  return csProductId(gameId) !== null;
}

/** Canonical game ids that have CS coverage (for diagnostics / gating UIs). */
export function csCoverageGames(): string[] {
  return Object.keys(CS_PRODUCT_BY_GAME);
}
