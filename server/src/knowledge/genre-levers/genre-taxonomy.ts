/**
 * Genre taxonomy + game→genre map.
 *
 * Adding a new game to the knowledge library is a one-line change here (plus,
 * optionally, game-pinned levers in a library file). No resolver/route edits.
 */

import type { Genre } from './lever-types.js';

/** Known genres. New genres append a slug here and author a library file. */
export const GENRES = ['competitive-fps', 'social-mmorpg'] as const;
export type KnownGenre = (typeof GENRES)[number];

/**
 * Game id → genre. Grounded by the live Cube models:
 *  - cfm_vn = CrossFire Mobile, a competitive F2P shooter (PvP ladder, clans,
 *    gacha crates, battle pass).
 *  - jus_vn = a wuxia social MMORPG (server-sharded, vertical VIP/role-level
 *    progression, whale-heavy; no guild/gacha/PvP data modelled).
 */
export const GAME_GENRE: Record<string, Genre> = {
  cfm_vn: 'competitive-fps',
  jus_vn: 'social-mmorpg',
};

/** Resolve a game's genre, or null if unmapped (unknown game). */
export function genreForGame(game: string): Genre | null {
  return GAME_GENRE[game] ?? null;
}
