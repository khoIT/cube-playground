/**
 * Game-id canonicalization — single source of truth, copied from
 * `cube-dev/cube/cube.js` GAME_ALIASES. Dependency-free so any layer (auth
 * bridge, Trino profiler, lakehouse writers) can import it without pulling DB
 * or connector deps. Keep in sync with cube-dev when its alias map grows.
 *
 * Legacy / country-suffixed gds.config ids (`cfm_vn`, `jus_vn`) are aliases of
 * the canonical key cube-dev tests membership against (`cfm`, `jus`).
 */

export const GAME_ALIASES: Record<string, string> = {
  cfm_vn: 'cfm',
  jus_vn: 'jus',
  ballistar_vn: 'ballistar',
};

/** Resolve a possibly-aliased game id to its canonical key. */
export function canonicalGameId(id: string): string {
  return GAME_ALIASES[id] ?? id;
}
