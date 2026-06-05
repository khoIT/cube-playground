/**
 * Workspace readiness aggregation.
 *
 * For a given workspace + owner, returns three sections used by the
 * Settings → Workspace tab:
 *
 *   - games[]   per-game cube availability (cube count from /meta, prefix-
 *               filtered for `prefix` workspaces). Marks each row 'ok' if
 *               there are cubes, 'missing' if zero, 'error' if /meta failed.
 *
 *   - coverage  shared business-metric registry reconciled against this
 *               workspace's /meta (broken refs + uncovered measures). Reuses
 *               `resolveCoverageAllGames` so the panel and the coverage tab
 *               see the same numbers.
 *
 *   - artifacts owner-scoped counts of saved artifacts that live in this
 *               workspace bucket — dashboards, segments, cube aliases.
 *               Survival ≈ count, since the per-workspace store guarantees
 *               rows here all belong to the active workspace by construction.
 *
 * Fail-open everywhere: any single source of failure surfaces as `status:'error'`
 * with a message — never throws.
 */

import type Database from 'better-sqlite3';

import { getMetaWithCtx, type WorkspaceCtx } from './cube-client.js';
import {
  resolveCubeTokenForWorkspace,
} from './resolve-cube-token.js';
import {
  loadWorkspacesConfig,
  resolveWorkspace,
  type WorkspaceDef,
} from './workspaces-config-loader.js';
import { loadGamesConfig } from './games-config-loader.js';
import {
  snapshotFromMeta,
  type MetaResponse,
  type MetaSnapshot,
} from './metric-ref-validator.js';
import { getAll as getAllBusinessMetrics } from './business-metrics-loader.js';
import {
  coverageFromSnapshot,
  matrixForGame,
  referencedMeasures,
  type CoverageReport,
} from './metric-coverage-resolver.js';
import {
  computePreaggReadiness,
  type PreaggReadiness,
} from './preagg-readiness.js';

export type GameReadinessStatus = 'ok' | 'missing' | 'error';

export interface GameReadiness {
  /** gds.config game id (always present). */
  id: string;
  /** Friendly label from gds.config. */
  label: string;
  /** Cube namespace prefix for prefix workspaces; null for game_id workspaces. */
  prefix: string | null;
  status: GameReadinessStatus;
  /** Distinct cube-name count visible for this game in the workspace's /meta. */
  cubeCount: number;
  /** Present when status==='error' — fetch/parse error. */
  error?: string;
}

export interface ArtifactCounts {
  dashboards: number;
  segments: number;
  cubeAliases: number;
}

export interface WorkspaceReadinessReport {
  workspace: {
    id: string;
    label: string;
    gameModel: WorkspaceDef['gameModel'];
    authMode: WorkspaceDef['authMode'];
  };
  generatedAt: string;
  games: GameReadiness[];
  coverage: CoverageReport;
  artifacts: ArtifactCounts;
  preaggs: PreaggReadiness;
}

/**
 * Build a per-game ctx for the workspace. game_id workspaces need a per-game
 * minted JWT; prefix workspaces share one (gameless) ctx because /meta is
 * already flat-namespaced and queryable without per-game claims.
 */
function buildCtxFor(workspace: WorkspaceDef, gameId: string | null): WorkspaceCtx {
  const { token } = resolveCubeTokenForWorkspace(workspace, gameId);
  return { cubeApiUrl: workspace.cubeApiUrl, token };
}

/**
 * For `prefix` workspaces, count cubes whose name starts with `${prefix}_`.
 * For `game_id` workspaces, the per-game meta IS the cube list — return
 * its size directly.
 */
function countGameCubes(
  snapshot: MetaSnapshot,
  workspace: WorkspaceDef,
  gameId: string,
): { count: number; prefix: string | null } {
  if (workspace.gameModel === 'prefix') {
    const prefix = workspace.gamePrefixMap?.[gameId];
    if (!prefix) return { count: 0, prefix: null };
    const needle = `${prefix}_`;
    let count = 0;
    for (const cube of snapshot.cubes) {
      if (cube.startsWith(needle)) count += 1;
    }
    return { count, prefix };
  }
  return { count: snapshot.cubes.size, prefix: null };
}

async function readGamesReadiness(
  workspace: WorkspaceDef,
): Promise<{ games: GameReadiness[]; snapshotByGame: Map<string, MetaSnapshot> }> {
  const cfg = loadGamesConfig();
  const snapshotByGame = new Map<string, MetaSnapshot>();
  // prefix workspaces: share a single /meta fetch across all games. game_id
  // workspaces: one /meta per game so each per-game JWT scopes correctly.
  let sharedSnapshot: MetaSnapshot | null = null;
  let sharedError: string | null = null;
  if (workspace.gameModel === 'prefix') {
    try {
      const meta = (await getMetaWithCtx(buildCtxFor(workspace, null))) as MetaResponse;
      sharedSnapshot = snapshotFromMeta(meta);
    } catch (err) {
      sharedError = err instanceof Error ? err.message : String(err);
    }
  }

  const games: GameReadiness[] = [];
  for (const g of cfg.games) {
    let snapshot: MetaSnapshot | null = sharedSnapshot;
    let error: string | null = sharedError;
    if (workspace.gameModel === 'game_id') {
      try {
        const meta = (await getMetaWithCtx(buildCtxFor(workspace, g.id))) as MetaResponse;
        snapshot = snapshotFromMeta(meta);
        error = null;
      } catch (err) {
        snapshot = null;
        error = err instanceof Error ? err.message : String(err);
      }
    }

    if (!snapshot) {
      games.push({
        id: g.id,
        label: g.name,
        prefix: workspace.gamePrefixMap?.[g.id] ?? null,
        status: 'error',
        cubeCount: 0,
        error: error ?? 'no meta available',
      });
      continue;
    }

    snapshotByGame.set(g.id, snapshot);
    const { count, prefix } = countGameCubes(snapshot, workspace, g.id);
    games.push({
      id: g.id,
      label: g.name,
      prefix,
      status: count > 0 ? 'ok' : 'missing',
      cubeCount: count,
    });
  }

  return { games, snapshotByGame };
}

/**
 * Build a coverage report from snapshots we already fetched in
 * readGamesReadiness — avoids a second /meta roundtrip per game.
 */
function coverageFromSnapshots(
  snapshotByGame: Map<string, MetaSnapshot>,
): CoverageReport {
  const metrics = getAllBusinessMetrics();
  const referenced = referencedMeasures(metrics);
  const games = loadGamesConfig().games.map((g) => g.id);
  const gameCoverages = games.map((gameId) => {
    const snapshot = snapshotByGame.get(gameId);
    if (!snapshot) {
      return {
        coverage: {
          game: gameId,
          status: 'error' as const,
          error: 'meta unavailable',
          cubesInMeta: 0,
          measuresInMeta: 0,
          brokenRefs: [],
          uncoveredMeasures: [],
        },
        matrix: [],
      };
    }
    return {
      coverage: coverageFromSnapshot(gameId, metrics, snapshot, referenced),
      matrix: matrixForGame(gameId, metrics, snapshot),
    };
  });
  return {
    games: gameCoverages.map((r) => r.coverage),
    matrix: gameCoverages.flatMap((r) => r.matrix),
    generatedAt: new Date().toISOString(),
  };
}

function countArtifacts(
  db: Database.Database,
  owner: string,
  workspaceId: string,
): ArtifactCounts {
  const safe = (sql: string): number => {
    try {
      const row = db.prepare(sql).get(owner, workspaceId) as { c?: number } | undefined;
      return row?.c ?? 0;
    } catch {
      // Table missing in test DBs etc — treat as 0 rather than 500.
      return 0;
    }
  };
  return {
    dashboards: safe(
      `SELECT COUNT(*) AS c FROM dashboards WHERE owner = ? AND workspace = ?`,
    ),
    segments: safe(
      `SELECT COUNT(*) AS c FROM segments WHERE owner = ? AND workspace = ?`,
    ),
    cubeAliases: safe(
      `SELECT COUNT(*) AS c FROM cube_aliases WHERE owner = ? AND workspace = ?`,
    ),
  };
}

// Lightweight per-game availability — just the games[] section of the full
// readiness report (per-game /meta + cube count), skipping the heavier coverage
// + artifact aggregation. Used by the game picker to hide games that don't
// resolve in the active workspace (e.g. prod-only games on local). Cached with
// a short TTL so repeated app loads / workspace flips don't re-fetch /meta per
// game every time.
interface GamesReadinessCacheEntry {
  at: number;
  games: GameReadiness[];
}
const gamesReadinessCache = new Map<string, GamesReadinessCacheEntry>();
const GAMES_READINESS_TTL_MS = 60_000;

export async function computeGamesReadiness(
  workspaceId: string,
): Promise<GameReadiness[]> {
  const cached = gamesReadinessCache.get(workspaceId);
  if (cached && Date.now() - cached.at < GAMES_READINESS_TTL_MS) {
    return cached.games;
  }
  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) throw new Error(`unknown workspace "${workspaceId}"`);
  const { games } = await readGamesReadiness(workspace);
  gamesReadinessCache.set(workspaceId, { at: Date.now(), games });
  return games;
}

export async function computeWorkspaceReadiness(
  db: Database.Database,
  workspaceId: string,
  owner: string,
): Promise<WorkspaceReadinessReport> {
  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) throw new Error(`unknown workspace "${workspaceId}"`);
  const [{ games, snapshotByGame }, preaggs] = await Promise.all([
    readGamesReadiness(workspace),
    computePreaggReadiness(workspace),
  ]);
  const coverage = coverageFromSnapshots(snapshotByGame);
  const artifacts = countArtifacts(db, owner, workspaceId);
  return {
    workspace: {
      id: workspace.id,
      label: workspace.label,
      gameModel: workspace.gameModel,
      authMode: workspace.authMode,
    },
    generatedAt: new Date().toISOString(),
    games,
    coverage,
    artifacts,
    preaggs,
  };
}

/** Convenience: returns every registered workspace's id (used by the FE switcher). */
export function listWorkspaceIds(): string[] {
  return loadWorkspacesConfig().workspaces.map((w) => w.id);
}
