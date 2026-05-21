/**
 * Derive the CDP `source` string from a (gameId, cube) pair.
 * Pattern: `game_integration.bi_<game>.etl_<cube>`. Override hook left as a
 * pure function so per-game overrides can be added without restructuring the
 * submit flow.
 */

export function deriveSource(gameId: string, cube: string | null): string {
  const safeCube = (cube ?? '').replace(/[^a-zA-Z0-9_]/g, '_') || 'unknown';
  const safeGame = gameId.replace(/[^a-zA-Z0-9_]/g, '_') || 'unknown';
  return `game_integration.bi_${safeGame}.etl_${safeCube}`;
}
