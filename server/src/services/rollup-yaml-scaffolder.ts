/**
 * Pure draft-rollup YAML scaffolder.
 *
 * Given a captured query's NAMES-only shape, emit a copy-pasteable
 * `pre_aggregations` block the admin can review and adapt. DRAFT only — no file
 * write, no Cube call, no auto-apply. The hard-won rollup authoring rules are
 * enforced in code so the draft doesn't reproduce known traps:
 *   - time_dimension MUST be the query's bound time dim (a mismatch silently
 *     falls through to source);
 *   - additive measures only (avg / exact count_distinct dropped + flagged);
 *   - per-user identity dimensions dropped (a rollup can't serve a row-listing);
 *   - a timestamp time-dim gets a build_range_end LEAST(...,current_timestamp)
 *     cap so future-dated rows don't stop partitions sealing.
 *
 * Pure: returns a string for the admin to copy. The emitted YAML carries NO
 * plan/phase references — only stable, self-contained reasoning.
 */

import { isIdentifierDim, isNonAdditiveMeasure, dominantCube, type Matchability, type RegistryView } from './query-perf-classifier.js';
import type { QueryShape } from './query-perf-store.js';

export interface ScaffoldOpts {
  matchability: Matchability;
  /** Per-game registry view — hints which dim is the time dim + existing names. */
  registryView?: RegistryView;
  /** Existing rollup names on the cube, for collision suffixing. */
  existingRollupNames?: Set<string>;
}

export interface ScaffoldResult {
  yaml: string | null;
  warnings: string[];
}

/** Time-dimension name fragments (best-effort when registry has no hint). */
const TIME_DIM_FRAGMENTS = ['date', 'time', 'day', 'month', '_at', '_ts'];

/** A timestamp (tz) time-dim needs the build_range_end cap; a DATE column does not. */
function isTimestampTimeDim(member: string): boolean {
  const name = member.toLowerCase();
  if (name.includes('date')) return false; // log_date etc. are DATE columns
  return name.includes('time') || name.endsWith('_at') || name.endsWith('_ts') || name.includes('dteventtime');
}

const bare = (member: string): string => {
  const i = member.indexOf('.');
  return i > 0 ? member.slice(i + 1) : member;
};

/** Pick the query's bound time dimension from its dimensions. */
function resolveTimeDim(shape: QueryShape, cube: string, view?: RegistryView): string | null {
  const hints = view?.[cube]?.timeDimensions ?? [];
  const byRegistry = shape.dimensions.find((d) => hints.includes(d));
  if (byRegistry) return byRegistry;
  return shape.dimensions.find((d) => TIME_DIM_FRAGMENTS.some((f) => d.toLowerCase().includes(f))) ?? null;
}

export function scaffoldRollupDraft(shape: QueryShape, opts: ScaffoldOpts): ScaffoldResult {
  const warnings: string[] = [];

  if (opts.matchability === 'unmatchable') {
    return {
      yaml: null,
      warnings: ['This query cannot be served by a rollup (per-user row listing). See the materialize-snapshot remedy.'],
    };
  }

  const cube = dominantCube(shape);
  if (!cube) {
    return { yaml: null, warnings: ['No cube could be identified from the query shape.'] };
  }

  // Single-cube rollup: keep only the dominant cube's members; flag any others.
  const memberCube = (m: string): boolean => m.startsWith(`${cube}.`);
  const foreignMembers = [...shape.measures, ...shape.dimensions].filter((m) => m.includes('.') && !memberCube(m));
  if (foreignMembers.length) {
    warnings.push(`members from other cubes excluded (a rollup is single-cube): ${foreignMembers.join(', ')}`);
  }

  // Additive measures only.
  const cubeMeasures = shape.measures.filter(memberCube);
  const nonAdditive = cubeMeasures.filter(isNonAdditiveMeasure);
  const additive = cubeMeasures.filter((m) => !isNonAdditiveMeasure(m));
  if (nonAdditive.length) {
    warnings.push(`non-additive measures excluded (remodel as sum+count or count_distinct_approx): ${nonAdditive.join(', ')}`);
  }
  if (additive.length === 0) {
    return { yaml: null, warnings: [...warnings, 'No additive measures to roll up.'] };
  }

  // Grouping dimensions: drop identity + the time dim itself.
  const timeDim = resolveTimeDim(shape, cube, opts.registryView);
  const identityDims = shape.dimensions.filter(isIdentifierDim);
  if (identityDims.length) {
    warnings.push(`per-user dimensions excluded (a rollup cannot serve per-user rows): ${identityDims.join(', ')}`);
  }
  const groupingDims = shape.dimensions
    .filter(memberCube)
    .filter((d) => !isIdentifierDim(d) && d !== timeDim);

  if (!timeDim) {
    warnings.push('No time dimension found in the query — a rollup needs one; add the appropriate time_dimension below.');
  }

  // Name + collision suffix.
  let name = `${bare(cube)}_batch`;
  const taken = opts.existingRollupNames ?? new Set<string>();
  if (taken.has(name)) {
    let n = 2;
    while (taken.has(`${name}_v${n}`)) n++;
    name = `${name}_v${n}`;
  }

  const needsCap = !!timeDim && isTimestampTimeDim(timeDim);
  const yaml = buildYaml({
    name,
    measures: additive.map(bare),
    dimensions: groupingDims.map(bare),
    timeDim: timeDim ? bare(timeDim) : null,
    needsCap,
  });

  return { yaml, warnings };
}

function buildYaml(p: {
  name: string;
  measures: string[];
  dimensions: string[];
  timeDim: string | null;
  needsCap: boolean;
}): string {
  const lines: string[] = [];
  lines.push('# DRAFT — review against live /meta; verify routing via the compiled SQL');
  lines.push('# (/cube-api/v1/sql) FROM clause, NOT usedPreAggregations (lambda rollups');
  lines.push('# report empty even when serving). Adjust granularity/partitioning to fit.');
  lines.push('pre_aggregations:');
  lines.push(`  ${p.name}:`);
  lines.push(`    measures: [${p.measures.join(', ')}]`);
  if (p.dimensions.length) lines.push(`    dimensions: [${p.dimensions.join(', ')}]`);
  if (p.timeDim) {
    lines.push(`    time_dimension: ${p.timeDim}   # MUST match the query's bound time dim`);
  } else {
    lines.push('    # time_dimension: <add the query time dimension here — required>');
  }
  lines.push('    granularity: day');
  lines.push('    partition_granularity: month');
  if (p.needsCap) {
    lines.push('    # timestamp time-dim: cap the build window so future-dated rows seal');
    lines.push('    build_range_end:');
    lines.push(`      sql: SELECT LEAST(MAX(${p.timeDim}), current_timestamp)`);
  }
  return lines.join('\n');
}
