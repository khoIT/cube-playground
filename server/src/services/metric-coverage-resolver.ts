/**
 * Metric ↔ cube coverage resolver.
 *
 * Reconciles the curated business-metrics registry against each game's live
 * Cube `/meta`, surfacing three gap types:
 *   1. brokenRefs        — registry metric refs that don't resolve in /meta.
 *   2. uncoveredMeasures — /meta measures referenced by no registry metric
 *                          (candidates to scaffold into draft metrics).
 *   3. matrix            — metric × game cell state (resolves|broken|cube-missing).
 *
 * Fail-open per game: a missing token or failed /meta fetch marks that game
 * `status:'error'` and never throws — one bad tenant can't blank the report.
 *
 * Pure helpers (`referencedMeasures`, `coverageFromSnapshot`) take a snapshot
 * so they unit-test without network. The async wrappers add token + /meta.
 */

import { getMeta, getMetaWithCtx, type WorkspaceCtx } from './cube-client.js';
import { resolveCubeTokenForGame } from './resolve-cube-token.js';
import { loadGamesConfig } from './games-config-loader.js';
import {
  snapshotFromMeta,
  validateRefs,
  parseFqn,
  extractRefs,
  type MetaResponse,
  type MetaSnapshot,
  type UnresolvedRef,
} from './metric-ref-validator.js';
import type { BusinessMetric } from '../types/business-metric.js';

export interface GameCoverage {
  game: string;
  status: 'ok' | 'drift' | 'error';
  /** Present when status==='error' — why this game couldn't be inspected. */
  error?: string;
  cubesInMeta: number;
  measuresInMeta: number;
  brokenRefs: UnresolvedRef[];
  /** `cube.member` measures in /meta that no registry metric references. */
  uncoveredMeasures: string[];
}

export type MatrixState = 'resolves' | 'broken' | 'cube-missing';

export interface MatrixCell {
  metricId: string;
  game: string;
  state: MatrixState;
}

export interface CoverageReport {
  games: GameCoverage[];
  matrix: MatrixCell[];
  generatedAt: string;
}

/**
 * Every measure ref the registry points at, fully-qualified. Ratio metrics
 * contribute numerator + denominator; expression inputs are included too.
 * Unparseable refs are skipped (they surface separately as broken refs).
 */
export function referencedMeasures(metrics: BusinessMetric[]): Set<string> {
  const out = new Set<string>();
  for (const m of metrics) {
    for (const ref of extractRefs(m)) {
      const parsed = parseFqn(ref);
      if (parsed) out.add(parsed.fqn);
    }
  }
  return out;
}

/**
 * Compute one game's coverage from an already-fetched snapshot. Pure — no I/O.
 */
export function coverageFromSnapshot(
  game: string,
  metrics: BusinessMetric[],
  snapshot: MetaSnapshot,
  referenced: Set<string>,
): GameCoverage {
  const brokenRefs = validateRefs(metrics, snapshot);
  const uncoveredMeasures = [...snapshot.measures]
    .filter((measure) => !referenced.has(measure))
    .sort();
  return {
    game,
    status: brokenRefs.length > 0 ? 'drift' : 'ok',
    cubesInMeta: snapshot.cubes.size,
    measuresInMeta: snapshot.measures.size,
    brokenRefs,
    uncoveredMeasures,
  };
}

/**
 * Per-metric matrix cells for one game, derived from its broken-ref set.
 * `cube-missing` (cube absent from /meta) outranks `broken` (member absent)
 * so the grid distinguishes "game lacks the cube" from "measure renamed".
 */
function matrixForGame(
  game: string,
  metrics: BusinessMetric[],
  snapshot: MetaSnapshot,
): MatrixCell[] {
  const broken = validateRefs(metrics, snapshot);
  const worst = new Map<string, MatrixState>();
  for (const u of broken) {
    const state: MatrixState = u.reason === 'cube-missing' ? 'cube-missing' : 'broken';
    // cube-missing wins over broken for the same metric.
    if (worst.get(u.metricId) !== 'cube-missing') worst.set(u.metricId, state);
  }
  return metrics.map((m) => ({
    metricId: m.id,
    game,
    state: worst.get(m.id) ?? 'resolves',
  }));
}

async function fetchSnapshot(
  game: string,
  ctx?: WorkspaceCtx,
): Promise<MetaSnapshot> {
  if (ctx) {
    const meta = (await getMetaWithCtx(ctx)) as MetaResponse;
    return snapshotFromMeta(meta);
  }
  const token = resolveCubeTokenForGame(game);
  if (!token) throw new Error(`no Cube token for game "${game}"`);
  const meta = (await getMeta(token)) as MetaResponse;
  return snapshotFromMeta(meta);
}

/** Coverage for a single game (fail-open: never throws — errors as status). */
export async function resolveCoverageForGame(
  metrics: BusinessMetric[],
  game: string,
  referenced: Set<string> = referencedMeasures(metrics),
  ctx?: WorkspaceCtx,
): Promise<{ coverage: GameCoverage; matrix: MatrixCell[] }> {
  try {
    const snapshot = await fetchSnapshot(game, ctx);
    return {
      coverage: coverageFromSnapshot(game, metrics, snapshot, referenced),
      matrix: matrixForGame(game, metrics, snapshot),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // No snapshot → every metric is unknown for this game; omit from matrix
    // (a separate `status:error` row tells the UI to grey the column).
    return {
      coverage: {
        game,
        status: 'error',
        error: message,
        cubesInMeta: 0,
        measuresInMeta: 0,
        brokenRefs: [],
        uncoveredMeasures: [],
      },
      matrix: [],
    };
  }
}

/** Coverage across every configured game. One /meta fetch per game. */
export async function resolveCoverageAllGames(
  metrics: BusinessMetric[],
  ctx?: WorkspaceCtx,
): Promise<CoverageReport> {
  const referenced = referencedMeasures(metrics);
  const games = loadGamesConfig().games.map((g) => g.id);
  const results = await Promise.all(
    games.map((g) => resolveCoverageForGame(metrics, g, referenced, ctx)),
  );
  return {
    games: results.map((r) => r.coverage),
    matrix: results.flatMap((r) => r.matrix),
    generatedAt: new Date().toISOString(),
  };
}
