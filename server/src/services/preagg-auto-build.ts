/**
 * Auto-build of newly-discovered unbuilt rollups.
 *
 * The collector already rescans the in-repo Cube model each pass (the readiness
 * registry is YAML-derived), so a freshly-added pre_aggregations block surfaces
 * as an `unbuilt` cube within minutes. This turns that signal into action: when
 * enabled, kick a scoped refresh-worker build for a game that has at least one
 * unbuilt rollup — i.e. "scan for new rollups and build them".
 *
 * "Ignore if we already handle":
 *   - A `built` (sealed/serving) rollup never enters the unbuilt set, so it is
 *     never rebuilt.
 *   - A per-game attempt cooldown stops thrashing on a rollup that STAYS unbuilt
 *     between passes (build genuinely failed, or cube_api hasn't reloaded a
 *     brand-new cube yet) — without it the 5-min collector would recreate the
 *     worker container every pass.
 *
 * Gated by PREAGG_AUTO_BUILD_ENABLED (off by default) — recreating the shared
 * worker container is privileged and stateful, same posture as the manual
 * trigger. Single-flight is enforced via the trigger's own running state.
 */

import type { PreaggReadiness } from './preagg-readiness.js';
import { startTrigger, getTriggerState, isTriggerEnabled } from './preagg-trigger.js';

/** Default cooldown between auto-build attempts for the same game (6 hours). */
export const AUTO_BUILD_COOLDOWN_MS = 6 * 3_600_000;

export function isAutoBuildEnabled(): boolean {
  return process.env.PREAGG_AUTO_BUILD_ENABLED === 'true';
}

/**
 * Pick the first game that has ≥1 `unbuilt` rollup and has not been attempted
 * within `cooldownMs`. Pure — no side effects — so it is unit-testable in
 * isolation. Returns the gameId to build, or null when nothing is eligible.
 */
export function selectAutoBuildGame(
  probe: PreaggReadiness,
  nowMs: number,
  lastAttempts: Map<string, number>,
  cooldownMs: number = AUTO_BUILD_COOLDOWN_MS,
): string | null {
  for (const game of probe.games) {
    const hasUnbuilt = game.cubes.some((c) => c.status === 'unbuilt');
    if (!hasUnbuilt) continue;
    const last = lastAttempts.get(game.id);
    if (last != null && nowMs - last < cooldownMs) continue; // recently handled
    return game.id;
  }
  return null;
}

/** Per-game timestamp of the last auto-build attempt (module-level, per process). */
const lastAttempts = new Map<string, number>();

/** Reset attempt history — used by tests to prevent cross-test bleed. */
export function __resetAutoBuildState(): void {
  lastAttempts.clear();
}

/**
 * Inspect a readiness probe and, when enabled, kick at most one scoped build for
 * a game with unbuilt rollups. Never throws — a failed start is logged and the
 * collector pass continues. Returns the gameId a build was started for, or null.
 */
export function maybeTriggerAutoBuild(
  probe: PreaggReadiness,
  nowMs: number = Date.now(),
): string | null {
  if (!isAutoBuildEnabled() || !isTriggerEnabled()) return null;
  // Single-flight: a build (manual or a prior auto-build) is already running.
  if (getTriggerState().phase === 'running') return null;

  const game = selectAutoBuildGame(probe, nowMs, lastAttempts);
  if (!game) return null;

  // Stamp the attempt BEFORE starting so a start failure still honours the
  // cooldown (avoids hammering a broken docker socket every pass).
  lastAttempts.set(game, nowMs);
  const res = startTrigger(game);
  if (res.ok) {
    console.log(`[preagg-auto-build] started scoped build for '${game}' (unbuilt rollups detected)`);
    return game;
  }
  console.warn(`[preagg-auto-build] could not start build for '${game}': ${res.error}`);
  return null;
}
