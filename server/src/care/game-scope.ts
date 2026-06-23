/**
 * Game-scope guard for care routes.
 *
 * `game` arrives as a query param (`?game=`), so it is untrusted: it must be
 * validated before flowing into a file path (calibration JSON) or a per-game
 * /meta scope. This guard:
 *   - rejects anything outside a strict id charset (kills path traversal), and
 *   - confirms the game is real for the active workspace — the games config on a
 *     game_id workspace; on a prefix workspace any charset-valid id resolves to
 *     its own cube-name prefix (the prod cube serves a game per id), so a bogus
 *     id simply yields an empty /meta scope rather than a rejection.
 *
 * Returns the game's Cube-name PREFIX (prefix workspaces) or null (game_id),
 * which the availability resolver uses to scope /meta to exactly this game —
 * never the union of every game's cubes.
 */

import type { WorkspaceDef } from '../services/workspaces-config-loader.js';
import { isKnownGame } from '../services/games-config-loader.js';

const GAME_ID_RE = /^[a-z0-9_]+$/;

export type GameScope =
  | { ok: true; gamePrefix: string | null }
  | { ok: false; error: string };

export function resolveGameScope(workspace: WorkspaceDef, game: string | undefined | null): GameScope {
  const g = game?.trim();
  if (!g) return { ok: false, error: 'query param "game" is required' };
  if (!GAME_ID_RE.test(g)) return { ok: false, error: `invalid game id "${g}"` };

  if (workspace.gameModel === 'prefix') {
    // The prod cube names every game's cubes `<gameId>__*`, so the prefix is the
    // (charset-validated) game id by default; gamePrefixMap overrides id ≠ prefix.
    const prefix = workspace.gamePrefixMap?.[g] ?? g;
    return { ok: true, gamePrefix: prefix };
  }

  // game_id workspace — validate against the configured games list.
  if (!isKnownGame(g)) return { ok: false, error: `unknown game "${g}"` };
  return { ok: true, gamePrefix: null };
}
