/**
 * Playbook threshold calibration runner (manual CLI).
 *
 *   tsx src/care/calibrate.ts <game_id> [workspace_id]
 *
 * For each cohort-queryable (membership) playbook of a game, runs a Cube count
 * with the compiled predicate and records the resulting cohort size. For
 * percentile rules it resolves the absolute cutoff at the p-th percentile.
 * Results are written to `data/care-calibration.<game>.json`, which the
 * playbooks route loads so percentile rules compile to a concrete cutoff and the
 * UI can show calibrated-vs-estimate.
 *
 * Must run where the Cube workspace is reachable (host dev / prod-mirror). When
 * /meta is unreachable the member set is empty and every playbook stays
 * unavailable — calibration never enables a playbook on a guess (fail-closed).
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWithCtx, type WorkspaceCtx } from '../services/cube-client.js';
import { treeToCubeFilters } from '../services/translator.js';
import { resolveWorkspace, getDefaultWorkspace } from '../services/workspaces-config-loader.js';
import { resolveCubeTokenForWorkspace } from '../services/resolve-cube-token.js';
import { getGameMembers } from './availability.js';
import { mergePlaybooks } from './playbook-merge.js';
import type { CalibrationResult } from './threshold-rule.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');

function calibrationPath(game: string): string {
  return join(DATA_DIR, `care-calibration.${game}.json`);
}

/** Load a previously-written calibration map for a game (empty if none). */
export function loadCalibration(game: string): Record<string, CalibrationResult> {
  const path = calibrationPath(game);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, CalibrationResult>;
  } catch {
    return {};
  }
}

function cubeOf(member: string): string {
  return member.split('.')[0] ?? '';
}

/** Run a Cube count over a predicate, returning the cohort size (0 on failure). */
async function countCohort(ctx: WorkspaceCtx, countMeasure: string, filters: unknown[]): Promise<number> {
  try {
    const res = (await loadWithCtx({ measures: [countMeasure], filters }, ctx)) as {
      data?: Record<string, unknown>[];
    };
    const row = res.data?.[0];
    const raw = row ? row[countMeasure] : undefined;
    const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : 0;
    return Number.isFinite(n) ? n : 0;
  } catch (err) {
    console.warn(`  ! count failed for ${countMeasure}: ${(err as Error).message}`);
    return 0;
  }
}

async function main(): Promise<void> {
  const game = process.argv[2];
  const wsId = process.argv[3];
  if (!game) {
    console.error('usage: tsx src/care/calibrate.ts <game_id> [workspace_id]');
    process.exit(1);
  }

  const workspace = (wsId ? resolveWorkspace(wsId) : undefined) ?? getDefaultWorkspace();
  const { token } = resolveCubeTokenForWorkspace(workspace, game);
  const ctx: WorkspaceCtx = { cubeApiUrl: workspace.cubeApiUrl, token };
  // Scope /meta to THIS game's prefix on prod (prefix) workspaces — never the union.
  const gamePrefix =
    workspace.gameModel === 'prefix' ? workspace.gamePrefixMap?.[game] ?? null : null;

  console.log(`Calibrating ${game} on workspace "${workspace.id}" (${workspace.cubeApiUrl})`);
  const members = await getGameMembers(ctx, gamePrefix, `calibrate:${workspace.id}:${game}`, true);
  console.log(`  /meta logical members: ${members.size}`);
  if (members.size === 0) {
    console.error('  /meta unreachable or empty — fail-closed, nothing calibrated.');
    process.exit(2);
  }

  const playbooks = mergePlaybooks(game, members);
  const out: Record<string, CalibrationResult> = {};
  const now = new Date().toISOString();

  for (const pb of playbooks) {
    if (pb.availability !== 'available') continue;
    if (pb.evalMode !== 'membership' || !pb.predicate) continue;

    // Count measure is derived from the gate member's cube. Multi-cube playbooks
    // or ones without a `.count` measure need an explicit measure — flag and skip
    // rather than querying a fabricated `.count`.
    const gateCube = cubeOf(pb.dataRequirements[0] ?? '');
    if (!gateCube) {
      console.log(`  [${pb.id}] ${pb.name}: no gate cube — skipped`);
      continue;
    }
    const countMeasure = `${gateCube}.count`;
    const filters = treeToCubeFilters(pb.predicate);
    const size = await countCohort(ctx, countMeasure, filters);
    // NOTE: percentile cutoff resolution (CalibrationResult.cutoff) needs a
    // percentile measure on the cube and is not yet computed here — only
    // cohortSize is recorded. No seed playbook uses a percentile rule today;
    // wiring true cutoff calibration is a Phase-1 follow-up.
    out[pb.id] = { cohortSize: size, computedAt: now };
    const flag = size > 0 ? 'ok' : '⚠ EMPTY';
    console.log(`  [${pb.id}] ${pb.name}: cohort=${size} ${flag} (measure=${countMeasure})`);
  }

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(calibrationPath(game), JSON.stringify(out, null, 2));
  console.log(`Wrote ${calibrationPath(game)}`);
}

// Run only when invoked directly (not when imported for loadCalibration).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
