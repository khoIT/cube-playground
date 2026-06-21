/**
 * Diff engine for the Model Audit UI. Combines the persisted YAML snapshots
 * (migration 067) with the pure diff functions to answer the three diff axes
 * the page renders:
 *   - dev ↔ prod-clone  (parity): latest run's dev blob vs its prod blob;
 *   - dev version ↔ version (temporal): two runs' dev blobs;
 * plus the cube version timeline and prod-clone git status/refresh.
 *
 * Everything reads from segments.db + git; no live cube-model filesystem access
 * is required, and the prod clone is never mutated except by refreshProdClone.
 */

import { getDb } from '../db/sqlite.js';
import {
  getSnapshotContent,
  listCubeVersions as readCubeVersions,
  latestOkRunId,
  type CubeVersion,
} from './cube-parity/cube-yaml-snapshot-reader.js';
import {
  extractCubeShape,
  structuredDiff,
  unifiedTextDiff,
  type StructuredDiff,
  type TextDiff,
} from './cube-parity/cube-yaml-structured-diff.js';

export {
  prodCloneStatus,
  refreshProdClone,
  PROD_ROOT,
  type ProdCloneStatus,
  type RefreshResult,
} from './cube-parity/cube-prod-clone-git.js';

export interface DevVsProdDiff {
  game: string;
  cube: string;
  runId: number;
  devPath: string | null;
  prodPath: string | null;
  /** true when the dev cube has no oracle counterpart in this run. */
  noCounterpart: boolean;
  structured: StructuredDiff;
  text: TextDiff;
}

export interface VersionDiff {
  game: string;
  cube: string;
  fromRunId: number;
  toRunId: number;
  structured: StructuredDiff;
  text: TextDiff;
}

/**
 * Dev↔prod diff for one cube using a run's persisted snapshots (defaults to the
 * latest ok run). Returns null only when there's no recorded run or the dev
 * side wasn't snapshotted; a missing PROD side is the expected no-counterpart
 * case (oracle-less game / dev-only cube), surfaced via `noCounterpart`.
 */
export function diffDevVsProd(game: string, cube: string, runId?: number): DevVsProdDiff | null {
  const db = getDb();
  const rid = runId ?? latestOkRunId(db);
  if (rid == null) return null;
  const dev = getSnapshotContent(db, rid, 'dev', game, cube);
  if (!dev) return null;
  const prod = getSnapshotContent(db, rid, 'prod', game, cube);
  const devShape = extractCubeShape(dev.content, cube);
  const prodShape = prod ? extractCubeShape(prod.content, cube) : null;
  // No oracle counterpart → don't render the whole dev file as one giant
  // "added" block (the UI short-circuits on noCounterpart anyway).
  const text = prod ? unifiedTextDiff(prod.content, dev.content) : { lines: [], added: 0, removed: 0 };
  return {
    game,
    cube,
    runId: rid,
    devPath: dev.path,
    prodPath: prod?.path ?? null,
    noCounterpart: prod == null,
    structured: structuredDiff(devShape, prodShape),
    text,
  };
}

/**
 * Diff a cube's dev YAML between two recorded runs (temporal/version diff).
 * `from` is treated as the older/"before" side. Returns null if either run
 * lacks a dev snapshot for the cube.
 */
export function diffDevVersions(
  game: string,
  cube: string,
  fromRunId: number,
  toRunId: number,
): VersionDiff | null {
  const db = getDb();
  const from = getSnapshotContent(db, fromRunId, 'dev', game, cube);
  const to = getSnapshotContent(db, toRunId, 'dev', game, cube);
  if (!from || !to) return null;
  return {
    game,
    cube,
    fromRunId,
    toRunId,
    structured: structuredDiff(extractCubeShape(to.content, cube), extractCubeShape(from.content, cube)),
    text: unifiedTextDiff(from.content, to.content),
  };
}

/** Version timeline for the history picker. */
export function listCubeVersions(game: string, cube: string): CubeVersion[] {
  return readCubeVersions(getDb(), game, cube);
}
