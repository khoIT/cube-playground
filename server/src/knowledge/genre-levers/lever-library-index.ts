/**
 * Lever library index + per-game resolver.
 *
 * Combines the genre libraries, selects the levers that apply to a game
 * (game-pinned OR genre-wide), runs the per-game data-gate against the live
 * member set, joins benchmarks, and partitions the result into:
 *   - levers      : assessable now (all required cubes present)
 *   - withheld    : applicable but missing required cubes (stated, never guessed)
 *   - blindSpots  : structurally unmeasurable (e.g. FPS cheating) — surfaced
 *
 * The resolver is pure (library + member set + game → resolution) so the route
 * owns the live `/meta` fetch and this stays unit-testable.
 */

import type {
  GenreLever,
  ResolvedLever,
  LeverResolution,
  WithheldLever,
  ResolvedBenchmark,
} from './lever-types.js';
import { FPS_LEVERS } from './lever-library-fps.js';
import { MMORPG_LEVERS } from './lever-library-mmorpg.js';
import { genreForGame } from './genre-taxonomy.js';
import { resolveBenchmark } from '../benchmark-resolver.js';

/** The full authored library (all genres). */
export const ALL_LEVERS: GenreLever[] = [...FPS_LEVERS, ...MMORPG_LEVERS];

/**
 * Resolve the dual benchmark for a single metric key, independent of any one
 * game. The external norm (when present) is sourced from the first authored
 * lever carrying that metricKey; the internal band comes from the portfolio
 * snapshot. A metric the library has never benchmarked still resolves — its
 * external side is simply empty (internal may still exist from the snapshot).
 */
export function resolveBenchmarkForMetric(metricKey: string): ResolvedBenchmark {
  const lever = ALL_LEVERS.find((l) => l.benchmark.metricKey === metricKey);
  return resolveBenchmark(lever ? lever.benchmark : { metricKey });
}

/** A lever applies to a game when it is game-pinned to it, or genre-wide and
 *  the game's genre is in its tags. */
function appliesToGame(lever: GenreLever, game: string, genre: string | null): boolean {
  if (lever.games.length > 0) return lever.games.includes(game);
  return genre != null && lever.genreTags.includes(genre);
}

function toResolved(lever: GenreLever): ResolvedLever {
  const { benchmark, ...rest } = lever;
  return { ...rest, benchmark: resolveBenchmark(benchmark) };
}

export interface ResolveOptions {
  /** Skip the data-gate (review/debug only): return every applicable lever as
   *  available regardless of live cube presence. Clearly a non-production view. */
  skipDataGate?: boolean;
}

/**
 * Resolve the lever library for one game against its live member set.
 * `members` is the set of logical `cube.member` tokens the game exposes
 * (empty set → everything non-blind-spot is withheld, fail-closed).
 */
export function resolveLeversForGame(
  game: string,
  members: Set<string>,
  opts: ResolveOptions = {},
): LeverResolution {
  const genre = genreForGame(game);
  const levers: ResolvedLever[] = [];
  const withheld: WithheldLever[] = [];
  const blindSpots: ResolvedLever[] = [];

  for (const lever of ALL_LEVERS) {
    if (!appliesToGame(lever, game, genre)) continue;

    if (lever.blindSpot) {
      blindSpots.push(toResolved(lever));
      continue;
    }

    if (opts.skipDataGate) {
      levers.push(toResolved(lever));
      continue;
    }

    const missing = lever.requiredCubes.filter((c) => !members.has(c));
    if (missing.length > 0) {
      withheld.push({
        id: lever.id,
        lever: lever.lever,
        reason: 'required cubes not available for this game',
        missingCubes: missing,
      });
      continue;
    }
    levers.push(toResolved(lever));
  }

  return { game, genre, levers, withheld, blindSpots };
}
