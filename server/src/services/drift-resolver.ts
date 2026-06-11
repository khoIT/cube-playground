/**
 * Drift-aware rehydration of a segment's cached Cube query.
 *
 * Compares the segment's persisted predicate_meta_version against the current
 * /meta hash. If they differ, re-translates the stored predicate tree against
 * the live /meta and verifies every referenced member still exists.
 *
 * Outcomes:
 *   { drifted: false }
 *     → safe to refresh against existing cube_query_json.
 *   { drifted: true, rehydrated: true, newCubeQuery, newMetaVersion }
 *     → translator regenerated a fresh cube_query_json; cron persists and proceeds.
 *   { drifted: true, rehydrated: false, missingMembers }
 *     → at least one referenced member no longer exists; cron marks broken.
 */

import { createHash } from 'node:crypto';

import { getMeta } from './cube-client.js';
import { getVersion } from './meta-cache.js';
import { parseCubeSegments } from './cube-query-segments.js';
import { treeToCubeFilters } from './translator.js';
import type { CubeFilter, PredicateNode } from '../types/predicate-tree.js';

export interface DriftResultSame {
  drifted: false;
}

export interface DriftResultRehydrated {
  drifted: true;
  rehydrated: true;
  newCubeQuery: { filters: CubeFilter[] };
  newMetaVersion: string;
}

export interface DriftResultBroken {
  drifted: true;
  rehydrated: false;
  missingMembers: string[];
  newMetaVersion: string;
}

export type DriftResult = DriftResultSame | DriftResultRehydrated | DriftResultBroken;

interface MetaDim {
  name: string;
}
interface MetaCube {
  name: string;
  dimensions?: MetaDim[];
  measures?: MetaDim[];
  segments?: MetaDim[];
}
interface MetaResponse {
  cubes?: MetaCube[];
}

function collectMemberRefs(node: PredicateNode, out: Set<string>): void {
  if (node.kind === 'leaf') {
    if (node.member) out.add(node.member);
    return;
  }
  for (const child of node.children) collectMemberRefs(child, out);
}

function collectKnownMembers(meta: MetaResponse): Set<string> {
  const out = new Set<string>();
  for (const cube of meta.cubes ?? []) {
    for (const d of cube.dimensions ?? []) out.add(d.name);
    for (const m of cube.measures ?? []) out.add(m.name);
  }
  return out;
}

export interface SegmentLike {
  predicate_tree_json: string | null;
  predicate_meta_version: string | null;
  /**
   * Stored query blob — carries the cube-segment sidecar (e.g. mf_users.whales)
   * so a segment removed from the cube model is caught here as explicit drift
   * instead of failing /load with an opaque Cube error.
   */
  cube_query_json?: string | null;
}

export async function resolveDrift(
  segment: SegmentLike,
  tokenOverride?: string,
): Promise<DriftResult> {
  // Per-game refreshes can't share the global meta-cache: the hash there is
  // computed against whichever yaml the default CUBE_TOKEN resolves to, which
  // is the wrong tenant. Fetch + hash inline when scoped to a specific token.
  let currentHash: string | null;
  let scopedMeta: MetaResponse | null = null;
  if (tokenOverride) {
    scopedMeta = (await getMeta(tokenOverride)) as MetaResponse;
    currentHash = createHash('sha256').update(JSON.stringify(scopedMeta)).digest('hex');
  } else {
    const current = await getVersion();
    currentHash = current.hash;
  }
  if (!currentHash) {
    // No version cached — treat as not-drifted so refresh proceeds.
    return { drifted: false };
  }
  if (segment.predicate_meta_version === currentHash) {
    return { drifted: false };
  }
  if (!segment.predicate_tree_json) {
    return { drifted: false };
  }

  const tree = JSON.parse(segment.predicate_tree_json) as PredicateNode;
  const referenced = new Set<string>();
  collectMemberRefs(tree, referenced);

  const meta = (scopedMeta ?? ((await getMeta(tokenOverride)) as MetaResponse)) as MetaResponse;
  const known = collectKnownMembers(meta);

  // Cube-segment sidecar: each must still exist as a named segment in /meta.
  // A removed one is non-rehydratable drift (its SQL lived in the model) — the
  // suffix tells the operator what kind of member vanished.
  const knownSegments = new Set<string>();
  for (const cube of meta.cubes ?? []) {
    for (const s of cube.segments ?? []) knownSegments.add(s.name);
  }
  const missingCubeSegments = (parseCubeSegments(segment.cube_query_json) ?? [])
    .filter((s) => !knownSegments.has(s))
    .map((s) => `${s} (cube segment)`);

  const missing = [...[...referenced].filter((m) => !known.has(m)), ...missingCubeSegments];
  if (missing.length > 0) {
    return {
      drifted: true,
      rehydrated: false,
      missingMembers: missing,
      newMetaVersion: currentHash,
    };
  }

  const filters = treeToCubeFilters(tree);
  return {
    drifted: true,
    rehydrated: true,
    newCubeQuery: { filters },
    newMetaVersion: currentHash,
  };
}
