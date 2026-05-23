/**
 * group-by-spec — resolves a GroupByKey axis to (a) the bucket key for a
 * given concept, (b) the human label per bucket, and (c) the order buckets
 * should render. The tab uses `groupConcepts` for sectioning and the same
 * `keyOf` resolver when toggling "select all in group" so the two stay in
 * sync regardless of which axis is active.
 *
 * Order rules per axis are documented inline. Buckets with no items are
 * naturally absent from the output (filter applied before grouping).
 */

import type { Concept, ConceptType } from './concept-types';

export type GroupByKey =
  | 'type'
  | 'cube'
  | 'kind'
  | 'usage'
  | 'aggType'
  | 'dimensionType';

export const GROUP_BY_KEYS: GroupByKey[] = [
  'type',
  'cube',
  'kind',
  'usage',
  'aggType',
  'dimensionType',
];

export const GROUP_BY_LABEL: Record<GroupByKey, string> = {
  type: 'Type',
  cube: 'Cube / View',
  kind: 'Source kind',
  usage: 'Usage',
  aggType: 'Aggregation',
  dimensionType: 'Dimension type',
};

export interface ConceptGroup {
  key: string;
  label: string;
  items: Concept[];
}

// Stable bucket label for the "doesn't apply" case on axis-specific groupings.
const NA_LABEL = '—';

const TYPE_ORDER: ConceptType[] = ['measure', 'dimension', 'segment'];
const TYPE_LABEL: Record<ConceptType, string> = {
  measure: 'Measures',
  dimension: 'Dimensions',
  segment: 'Segments',
};

const KIND_ORDER: Array<'cube' | 'view'> = ['cube', 'view'];
const KIND_LABEL: Record<'cube' | 'view', string> = {
  cube: 'Cubes',
  view: 'Views',
};

// Usage buckets: derived from usage count via `usageBucketKey`.
const USAGE_ORDER = ['heavy', 'medium', 'unreferenced'] as const;
const USAGE_LABEL: Record<(typeof USAGE_ORDER)[number], string> = {
  heavy: 'Heavy use (5+)',
  medium: 'Medium use (1–4)',
  unreferenced: 'Unreferenced',
};

function usageBucketKey(count: number): (typeof USAGE_ORDER)[number] {
  if (count >= 5) return 'heavy';
  if (count >= 1) return 'medium';
  return 'unreferenced';
}

/** Bucket key a single concept belongs to under the given axis. */
export function keyOf(
  concept: Concept,
  by: GroupByKey,
  usageMap: Map<string, number>,
): string {
  switch (by) {
    case 'type':
      return concept.type;
    case 'cube':
      return concept.cube;
    case 'kind':
      return concept.cubeKind;
    case 'usage':
      return usageBucketKey(usageMap.get(concept.fqn) ?? 0);
    case 'aggType':
      return concept.type === 'measure'
        ? concept.meta?.aggType ?? NA_LABEL
        : NA_LABEL;
    case 'dimensionType':
      return concept.type === 'dimension'
        ? concept.meta?.dimensionType ?? NA_LABEL
        : NA_LABEL;
  }
}

function labelFor(by: GroupByKey, key: string): string {
  switch (by) {
    case 'type':
      return TYPE_LABEL[key as ConceptType] ?? key;
    case 'cube':
      return key;
    case 'kind':
      return KIND_LABEL[key as 'cube' | 'view'] ?? key;
    case 'usage':
      return USAGE_LABEL[key as (typeof USAGE_ORDER)[number]] ?? key;
    case 'aggType':
    case 'dimensionType':
      return key;
  }
}

// Per-axis comparator. Falls back to alphabetical when no fixed order applies.
// The NA bucket is always pushed to the end of axis-specific groupings so the
// "doesn't apply" rows don't crowd the meaningful ones at the top.
function orderIndex(by: GroupByKey, key: string): number {
  switch (by) {
    case 'type':
      return TYPE_ORDER.indexOf(key as ConceptType);
    case 'kind':
      return KIND_ORDER.indexOf(key as 'cube' | 'view');
    case 'usage':
      return USAGE_ORDER.indexOf(key as (typeof USAGE_ORDER)[number]);
    default:
      return -1;
  }
}

function sortGroups(by: GroupByKey, groups: ConceptGroup[]): ConceptGroup[] {
  return [...groups].sort((a, b) => {
    if (by === 'aggType' || by === 'dimensionType') {
      // NA bucket always last; otherwise alphabetical.
      if (a.key === NA_LABEL && b.key !== NA_LABEL) return 1;
      if (b.key === NA_LABEL && a.key !== NA_LABEL) return -1;
      return a.key.localeCompare(b.key);
    }
    const ia = orderIndex(by, a.key);
    const ib = orderIndex(by, b.key);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.key.localeCompare(b.key);
  });
}

/** Bucket + order concepts for the chosen axis. */
export function groupConcepts(
  items: Concept[],
  by: GroupByKey,
  usageMap: Map<string, number>,
): ConceptGroup[] {
  const bucketed = new Map<string, ConceptGroup>();
  for (const c of items) {
    const k = keyOf(c, by, usageMap);
    const existing = bucketed.get(k);
    if (existing) {
      existing.items.push(c);
    } else {
      bucketed.set(k, { key: k, label: labelFor(by, k), items: [c] });
    }
  }
  return sortGroups(by, [...bucketed.values()]);
}
