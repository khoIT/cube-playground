/**
 * Validates that every formula reference in the business-metrics registry
 * resolves to a real Cube member (`cube.member`) for a given /meta payload.
 *
 * Pure: takes a registry slice + a known-members set, returns unresolved refs.
 * The CLI script `check-metric-drift.ts` wraps this with per-game /meta fetches.
 */

import type { BusinessMetric } from '../types/business-metric.js';

export interface ParsedRef {
  fqn: string;
  cube: string;
  member: string;
}

export interface UnresolvedRef {
  metricId: string;
  ref: string;
  reason: 'unparseable' | 'cube-missing' | 'member-missing';
}

/**
 * Pull every cube-qualified reference from a metric's formula. Order matches
 * the formula's natural reading order (numerator before denominator, inputs
 * preserved), so the consumer can attribute back to the originating slot.
 */
export function extractRefs(metric: BusinessMetric): string[] {
  const f = metric.formula;
  if (f.type === 'measure') return [f.ref];
  if (f.type === 'ratio') return [f.numerator, f.denominator];
  if (f.type === 'expression') return [...(f.inputs ?? [])];
  return [];
}

export function parseFqn(ref: string): ParsedRef | null {
  const dot = ref.indexOf('.');
  if (dot <= 0 || dot === ref.length - 1) return null;
  return { fqn: ref, cube: ref.slice(0, dot), member: ref.slice(dot + 1) };
}

export interface MetaSnapshot {
  /** Set of fully-qualified member names — `cube.member` (measures + dimensions). */
  members: Set<string>;
  /** Subset of `members` that are measures only — used for coverage gap detection. */
  measures: Set<string>;
  /** Set of cube names that exist in this meta. */
  cubes: Set<string>;
}

/**
 * Inputs the validator needs from a `/meta` payload. The Cube response shape
 * has `cubes[].measures[].name` and `cubes[].dimensions[].name` already
 * fully-qualified (e.g. `mf_users.user_count`), so building the snapshot is
 * a straight Set fill.
 */
export interface MetaResponse {
  cubes?: Array<{
    name: string;
    measures?: Array<{ name: string }>;
    dimensions?: Array<{ name: string }>;
  }>;
}

export function snapshotFromMeta(meta: MetaResponse): MetaSnapshot {
  const members = new Set<string>();
  const measures = new Set<string>();
  const cubes = new Set<string>();
  for (const cube of meta.cubes ?? []) {
    cubes.add(cube.name);
    for (const m of cube.measures ?? []) {
      members.add(m.name);
      measures.add(m.name);
    }
    for (const d of cube.dimensions ?? []) members.add(d.name);
  }
  return { members, measures, cubes };
}

/**
 * Cross-checks every formula ref against `snapshot`. A ref is "unresolved" if:
 *   - it doesn't parse as `cube.member` (shape problem), or
 *   - the cube part isn't in `snapshot.cubes` (cube missing for this game), or
 *   - the full `cube.member` isn't in `snapshot.members` (declared on a sibling
 *     cube, removed, renamed, etc.).
 */
export function validateRefs(
  metrics: BusinessMetric[],
  snapshot: MetaSnapshot,
): UnresolvedRef[] {
  const out: UnresolvedRef[] = [];
  for (const metric of metrics) {
    for (const ref of extractRefs(metric)) {
      const parsed = parseFqn(ref);
      if (!parsed) {
        out.push({ metricId: metric.id, ref, reason: 'unparseable' });
        continue;
      }
      if (!snapshot.cubes.has(parsed.cube)) {
        out.push({ metricId: metric.id, ref, reason: 'cube-missing' });
        continue;
      }
      if (!snapshot.members.has(parsed.fqn)) {
        out.push({ metricId: metric.id, ref, reason: 'member-missing' });
      }
    }
  }
  return out;
}
