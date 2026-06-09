/**
 * Auto-sweep cron for the VIP-care ledger.
 *
 * Every 6h, sweeps each eligible game (≥1 membership playbook resolving
 * available) against the live Cube, recording a snapshot run per game so the
 * trend / diff views accrue history without anyone clicking "Run sweep".
 *
 * Runs server-side with NO request: builds a service-principal Cube ctx from the
 * default workspace (same token path the route's introspection ctx uses). Single
 * instance, in-process — matches the other crons; no advisory lock. Sequential
 * across games (each sweep is a ~2-min Trino op — never fire them concurrently).
 * Fail-soft per game: one game's error records an 'error' run and the loop
 * continues. No boot sweep (a mass live sweep on every restart is wasteful) —
 * the first pass fires one interval after start. The shared in-flight mutex in
 * care-sweep-execute skips any game a manual sweep is already running.
 */

import { getDefaultWorkspace } from '../services/workspaces-config-loader.js';
import { resolveCubeTokenForWorkspace } from '../services/resolve-cube-token.js';
import { loadGamesConfig } from '../services/games-config-loader.js';
import { resolveGameScope } from '../care/game-scope.js';
import { getGameMembers } from '../care/availability.js';
import { mergePlaybooks } from '../care/playbook-merge.js';
import { executeSweep, isSweepInFlight, SweepBusyError } from '../care/care-sweep-execute.js';
import type { WorkspaceCtx } from '../services/cube-client.js';
import type { WorkspaceDef } from '../services/workspaces-config-loader.js';

export const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h

/** Service-principal introspection ctx for a game (no user — playground principal). */
function buildCronCtx(workspace: WorkspaceDef, game: string): WorkspaceCtx {
  const { token } = resolveCubeTokenForWorkspace(workspace, game);
  return { cubeApiUrl: workspace.cubeApiUrl, token };
}

/**
 * A game is eligible if at least one membership (cohort-queryable) playbook
 * resolves 'available' for its live model — otherwise a sweep would only ever
 * skip every playbook. Probes /meta (forced) like the route does.
 */
async function isGameEligible(workspace: WorkspaceDef, game: string, ctx: WorkspaceCtx): Promise<boolean> {
  const scope = resolveGameScope(workspace, game);
  if (!scope.ok) return false;
  const members = await getGameMembers(ctx, scope.gamePrefix, `${workspace.id}:${game}`, true);
  return mergePlaybooks(game, members).some(
    (pb) => pb.enabled && pb.availability !== 'unavailable' && pb.evalMode !== 'trigger' && pb.predicate != null,
  );
}

/** Run one tick: sweep every eligible, not-in-flight game sequentially. `now` unused (timer-driven) but kept for symmetry/tests. */
export async function careAutoSweepTick(): Promise<{ swept: number; skipped: number; failed: number }> {
  const workspace = getDefaultWorkspace();
  let swept = 0;
  let skipped = 0;
  let failed = 0;

  let games: string[];
  try {
    games = loadGamesConfig().games.map((g) => g.id);
  } catch (err) {
    console.warn('[care-auto-sweep] games config unreadable; skipping tick:', (err as Error).message);
    return { swept, skipped, failed };
  }

  for (const game of games) {
    if (isSweepInFlight(workspace.id, game)) {
      skipped++;
      continue; // a manual sweep is already running this game
    }
    const ctx = buildCronCtx(workspace, game);
    try {
      if (!(await isGameEligible(workspace, game, ctx))) {
        skipped++;
        continue;
      }
      const r = await executeSweep(workspace, game, ctx, 'cron');
      swept++;
      console.log(`[care-auto-sweep] ${game}: opened ${r.opened}, lapsed ${r.lapsed}, profiles ${r.profilesRefreshed} (${r.status})`);
    } catch (err) {
      if (err instanceof SweepBusyError) {
        skipped++;
        continue;
      }
      failed++; // executeSweep already recorded an 'error' run
      console.warn(`[care-auto-sweep] ${game} failed (other games continue):`, (err as Error).message);
    }
  }

  console.log(`[care-auto-sweep] tick done — swept ${swept}, skipped ${skipped}, failed ${failed}`);
  return { swept, skipped, failed };
}

let interval: ReturnType<typeof setInterval> | null = null;

export function startCareAutoSweepCron(): void {
  if (interval) return;
  // No boot sweep — first pass fires one interval after start.
  interval = setInterval(() => {
    careAutoSweepTick().catch((err) => {
      console.warn('[care-auto-sweep] tick threw:', (err as Error).message);
    });
  }, SWEEP_INTERVAL_MS);
}

/** Test-only: stop the timer so a suite doesn't leak an open handle. */
export function __stopCareAutoSweepCron(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
