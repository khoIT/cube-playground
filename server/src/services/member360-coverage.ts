/**
 * Member-360 coverage classifier.
 *
 * Surfaces, per game, whether each 360 panel/view actually works in a given
 * workspace — across the three gated layers (Trino → Cube YAML → product
 * config). Hybrid signal:
 *
 *   1. /meta diff   — is the view's cube modeled, and are all members the panel
 *                     reads present? (catches "no views/<game>/user_360.yml yet"
 *                     and "view modeled but missing a field")
 *   2. 1-row probe  — for fully-modeled views, does the underlying table return
 *                     any rows? (catches "modeled but Trino has no data")
 *
 * Status per panel:
 *   - blocked : view cube absent from /meta (not modeled at all)
 *   - partial : view modeled but ≥1 required member missing
 *   - empty   : view fully modeled, probe returned 0 rows
 *   - ready   : view fully modeled + probe returned ≥1 row
 *
 * Game rollup: na (no 360 config) · error (/meta failed) · else ready when every
 * panel ready, blocked when every panel blocked, partial otherwise.
 *
 * Scope: `game_id` workspaces (local) get full classification — bare member
 * names match the per-game /meta. `prefix` workspaces (prod, upstream kraken
 * model) are flagged `prefixUnsupported` and not probed; evaluating prefixed
 * 360 views upstream is a tracked follow-up.
 *
 * Fail-open: any per-game failure becomes `status:'error'` with a message —
 * never throws past the cache boundary.
 */

import { getMetaWithCtx, loadWithCtx, type WorkspaceCtx } from './cube-client.js';
import { resolveCubeTokenForWorkspace } from './resolve-cube-token.js';
import {
  resolveWorkspace,
  type WorkspaceDef,
} from './workspaces-config-loader.js';
import { loadGamesConfig } from './games-config-loader.js';
import {
  snapshotFromMeta,
  type MetaResponse,
  type MetaSnapshot,
} from './metric-ref-validator.js';
import {
  corePanelsForGame,
  type Member360Panel,
} from './member360-panel-registry.js';

export type PanelCoverageStatus = 'ready' | 'partial' | 'empty' | 'blocked';
export type GameCoverageStatus = PanelCoverageStatus | 'na' | 'error';

export interface PanelCoverage {
  /** Panel id from the registry (stable). */
  id: string;
  title: string;
  /** Cube view the panel reads (`user_profile`, `user_recharge_timeline`, …). */
  view: string;
  status: PanelCoverageStatus | 'error';
  /** Count of required members present in /meta vs total the panel reads. */
  modeledMembers: number;
  totalMembers: number;
  /** Required members absent from /meta (drives the "needs modeling" detail). */
  missingMembers: string[];
  /** null when not probed (blocked/partial) or probe errored. */
  hasRows: boolean | null;
  /** Present on probe/classification error. */
  error?: string;
}

export interface GameCoverage {
  game: string;
  label: string;
  /** False when the game has no 360 product config at all. */
  has360Config: boolean;
  status: GameCoverageStatus;
  panels: PanelCoverage[];
  /** Set when classification couldn't run (meta error, prefix workspace, …). */
  note?: string;
}

export interface Member360CoverageReport {
  workspace: {
    id: string;
    label: string;
    gameModel: WorkspaceDef['gameModel'];
  };
  /** True for prefix (prod) workspaces — coverage not yet evaluated upstream. */
  prefixUnsupported: boolean;
  generatedAt: string;
  games: GameCoverage[];
}

/** Distinct `view.field` members a panel actually reads (columns + kpis + time). */
export function requiredMembers(p: Member360Panel): string[] {
  const s = new Set<string>();
  for (const c of p.columns) s.add(c.member);
  for (const k of p.kpis ?? []) s.add(k.member);
  if (p.timeDimension) s.add(p.timeDimension);
  return [...s];
}

/**
 * Cheapest member to probe a view's existence with. Prefer a plain column over
 * the time dimension: selecting a monthly time dimension (`log_month`) as a bare
 * dimension makes Trino reject the cast ("must be a time or timestamp"). A
 * non-time dimension with `limit:1` is a clean has-any-rows check.
 */
export function probeMember(p: Member360Panel): string | null {
  const nonTime = p.columns.find((c) => c.member !== p.timeDimension);
  if (nonTime) return nonTime.member;
  return p.columns[0]?.member ?? p.timeDimension ?? null;
}

function buildCtxFor(ws: WorkspaceDef, gameId: string | null): WorkspaceCtx {
  const { token } = resolveCubeTokenForWorkspace(ws, gameId);
  return { cubeApiUrl: ws.cubeApiUrl, token };
}

/** 1-row existence probe for a fully-modeled view. */
async function probeHasRows(
  ctx: WorkspaceCtx,
  member: string,
): Promise<boolean> {
  const res = (await loadWithCtx(
    { dimensions: [member], limit: 1 },
    ctx,
  )) as { data?: unknown[] };
  return (res.data?.length ?? 0) > 0;
}

/** Classify one panel against the game's /meta snapshot (+ optional probe). */
async function classifyPanel(
  ctx: WorkspaceCtx,
  snapshot: MetaSnapshot,
  panel: Member360Panel,
): Promise<PanelCoverage> {
  const required = requiredMembers(panel);
  const base = {
    id: panel.id,
    title: panel.title,
    view: panel.view,
    totalMembers: required.length,
  };

  if (!snapshot.cubes.has(panel.view)) {
    return {
      ...base,
      status: 'blocked',
      modeledMembers: 0,
      missingMembers: required,
      hasRows: null,
    };
  }

  const missing = required.filter((m) => !snapshot.members.has(m));
  const modeledMembers = required.length - missing.length;
  if (missing.length > 0) {
    return {
      ...base,
      status: 'partial',
      modeledMembers,
      missingMembers: missing,
      hasRows: null,
    };
  }

  // Fully modeled → probe for data.
  const member = probeMember(panel);
  if (!member) {
    return { ...base, status: 'ready', modeledMembers, missingMembers: [], hasRows: null };
  }
  try {
    const hasRows = await probeHasRows(ctx, member);
    return {
      ...base,
      status: hasRows ? 'ready' : 'empty',
      modeledMembers,
      missingMembers: [],
      hasRows,
    };
  } catch (err) {
    return {
      ...base,
      status: 'error',
      modeledMembers,
      missingMembers: [],
      hasRows: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Roll panel statuses up to a single headline for the matrix cell. */
export function rollupGameStatus(panels: PanelCoverage[]): GameCoverageStatus {
  if (panels.length === 0) return 'na';
  if (panels.some((p) => p.status === 'error')) return 'error';
  if (panels.every((p) => p.status === 'ready')) return 'ready';
  if (panels.every((p) => p.status === 'blocked')) return 'blocked';
  return 'partial';
}

async function classifyGame(
  ctx: WorkspaceCtx,
  gameId: string,
  label: string,
): Promise<GameCoverage> {
  const panelDefs = corePanelsForGame(gameId);
  if (panelDefs.length === 0) {
    return { game: gameId, label, has360Config: false, status: 'na', panels: [] };
  }
  let snapshot: MetaSnapshot;
  try {
    const meta = (await getMetaWithCtx(ctx)) as MetaResponse;
    snapshot = snapshotFromMeta(meta);
  } catch (err) {
    return {
      game: gameId,
      label,
      has360Config: true,
      status: 'error',
      panels: [],
      note: err instanceof Error ? err.message : String(err),
    };
  }
  const panels: PanelCoverage[] = [];
  for (const p of panelDefs) {
    panels.push(await classifyPanel(ctx, snapshot, p));
  }
  return {
    game: gameId,
    label,
    has360Config: true,
    status: rollupGameStatus(panels),
    panels,
  };
}

interface CoverageCacheEntry {
  at: number;
  report: Member360CoverageReport;
}
const coverageCache = new Map<string, CoverageCacheEntry>();
const COVERAGE_TTL_MS = 60_000;

export async function computeMember360Coverage(
  workspaceId: string,
): Promise<Member360CoverageReport> {
  const cached = coverageCache.get(workspaceId);
  if (cached && Date.now() - cached.at < COVERAGE_TTL_MS) {
    return cached.report;
  }
  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) throw new Error(`unknown workspace "${workspaceId}"`);

  const cfg = loadGamesConfig();
  const prefixUnsupported = workspace.gameModel === 'prefix';

  let games: GameCoverage[];
  if (prefixUnsupported) {
    // Prefixed (prod) /meta uses `<prefix>_cube.field`; the registry's bare
    // member names don't resolve. Flag rather than mis-report as blocked.
    games = cfg.games.map((g) => {
      const has360 = corePanelsForGame(g.id).length > 0;
      return {
        game: g.id,
        label: g.name,
        has360Config: has360,
        status: has360 ? ('error' as const) : ('na' as const),
        panels: [],
        note: has360
          ? 'prefix-workspace coverage not yet evaluated (upstream model)'
          : undefined,
      };
    });
  } else {
    // game_id (local): per-game minted JWT scopes each /meta to one schema.
    games = [];
    for (const g of cfg.games) {
      const ctx = buildCtxFor(workspace, g.id);
      games.push(await classifyGame(ctx, g.id, g.name));
    }
  }

  const report: Member360CoverageReport = {
    workspace: {
      id: workspace.id,
      label: workspace.label,
      gameModel: workspace.gameModel,
    },
    prefixUnsupported,
    generatedAt: new Date().toISOString(),
    games,
  };
  coverageCache.set(workspaceId, { at: Date.now(), report });
  return report;
}
