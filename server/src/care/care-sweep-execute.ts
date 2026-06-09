/**
 * Shared sweep executor — the single path that materializes a game's VIP cohort
 * against the live Cube, opens/lapses cases, enriches profiles, and snapshots the
 * run. Used by BOTH the manual sweep route (source 'manual') and the 6h auto-sweep
 * cron (source 'cron') so the record/enrich logic lives in one place.
 *
 * An in-process per-(workspace, game) mutex stops a manual sweep and a cron tick
 * from double-sweeping the same game concurrently (single-instance assumption,
 * matching the other in-process crons). A hard failure records an 'error' run for
 * observability, then re-throws so the caller can surface it (route → 502, cron →
 * log + continue).
 */

import type { WorkspaceCtx } from '../services/cube-client.js';
import type { WorkspaceDef } from '../services/workspaces-config-loader.js';
import { resolveGameScope } from './game-scope.js';
import { getGameMembers } from './availability.js';
import { loadCalibration } from './calibrate.js';
import { runCaseSweep, makeCubeCohortFetcher, type PlaybookSweepSummary } from './care-case-sweep.js';
import { listCases } from './care-case-store.js';
import { makeCubeProfileFetcher } from './care-vip-profile-fetch.js';
import { upsertVipProfiles } from './care-vip-profile-store.js';
import { recordSweep, recordFailedSweep, deriveRunStatus, type SweepRunSource, type SweepRunStatus } from './care-sweep-run-store.js';

/** Per-(workspace, game) in-flight set; shared by route + cron to avoid overlap. */
const inFlight = new Set<string>();
const keyOf = (workspaceId: string, game: string) => `${workspaceId}:${game}`;

export function isSweepInFlight(workspaceId: string, game: string): boolean {
  return inFlight.has(keyOf(workspaceId, game));
}

/** Raised when a sweep is requested for a game already being swept. */
export class SweepBusyError extends Error {
  constructor(game: string) {
    super(`sweep already in progress for ${game}`);
    this.name = 'SweepBusyError';
  }
}

/** Public summary shape (server-internal cohort uids stripped). */
export type PublicSweepSummary = Omit<PlaybookSweepSummary, 'uids'>;

export interface SweepExecuteResult {
  opened: number;
  lapsed: number;
  profilesRefreshed: number;
  status: SweepRunStatus;
  runId: string | null;
  summaries: PublicSweepSummary[];
}

/**
 * Run + record one sweep for (workspace, game) under the given Cube ctx.
 * Throws SweepBusyError if the game is already in flight, or the underlying
 * error (after recording an 'error' run) if the live Cube/meta fails.
 */
export async function executeSweep(
  workspace: WorkspaceDef,
  game: string,
  ctx: WorkspaceCtx,
  source: SweepRunSource,
): Promise<SweepExecuteResult> {
  const key = keyOf(workspace.id, game);
  if (inFlight.has(key)) throw new SweepBusyError(game);
  inFlight.add(key);

  const startedAt = new Date().toISOString();
  try {
    const scope = resolveGameScope(workspace, game);
    if (!scope.ok) throw new Error(scope.error);

    // Force a fresh member set so gating reflects the live model, not a cached probe.
    const members = await getGameMembers(ctx, scope.gamePrefix, key, true);
    const deps = { fetchCohortUids: makeCubeCohortFetcher(ctx, game, workspace.id, members) };
    const summaries = await runCaseSweep(game, workspace.id, members, deps, loadCalibration(game));
    const opened = summaries.reduce((n, s) => n + s.opened, 0);
    const lapsed = summaries.reduce((n, s) => n + s.lapsed, 0);

    // Persist VIP profile snapshots for every open case so the queue reads them
    // from SQLite. Best-effort: a profile-fetch failure must not fail the sweep.
    let profilesRefreshed = 0;
    try {
      const openUids = [...new Set(
        listCases({ gameId: game })
          .filter((c) => c.status !== 'resolved' && c.status !== 'dismissed')
          .map((c) => c.uid),
      )];
      if (openUids.length > 0) {
        const snapshots = await makeCubeProfileFetcher(ctx, game, workspace.id)(openUids);
        upsertVipProfiles(game, workspace.id, snapshots);
        profilesRefreshed = snapshots.length;
      }
    } catch {
      /* profile enrichment is best-effort; cases are still swept */
    }

    // Snapshot the run (run + per-playbook counts + per-uid membership) for the
    // trend / diff views. Best-effort — a record failure must not fail the sweep.
    let runId: string | null = null;
    try {
      runId = recordSweep(
        {
          game,
          workspaceId: workspace.id,
          source,
          startedAt,
          finishedAt: new Date().toISOString(),
          openedTotal: opened,
          lapsedTotal: lapsed,
          profilesRefreshed,
        },
        summaries,
      );
    } catch {
      /* recording is best-effort; the sweep itself already applied */
    }

    // Strip server-internal cohort uids — the FE only needs counts.
    const publicSummaries: PublicSweepSummary[] = summaries.map(({ uids: _uids, ...rest }) => rest);
    return { opened, lapsed, profilesRefreshed, status: deriveRunStatus(summaries), runId, summaries: publicSummaries };
  } catch (err) {
    // Hard failure (Cube unreachable / meta failed) — record an error run so the
    // failure is visible in the timeline, then re-throw for the caller to surface.
    try {
      recordFailedSweep({ game, workspaceId: workspace.id, source, startedAt, finishedAt: new Date().toISOString() });
    } catch {
      /* best-effort */
    }
    throw err;
  } finally {
    inFlight.delete(key);
  }
}
