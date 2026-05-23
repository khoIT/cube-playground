/**
 * useFilteredConcepts — composes Type / Cube / "CDP-projected" / "Unreferenced"
 * filters with a free-text query and the business-metrics registry.
 *
 * "Used by N metrics" counts each concept's appearances across all formulas
 * in the registry. The result is a Map<fqn, count> the caller renders inline
 * on each card. Pure computation, no fetch.
 */

import { useMemo } from 'react';

import type { BusinessMetric } from '../metrics-tab/business-metric-types';
import type { Concept, ConceptType } from './concept-types';
import type { GroupByKey } from './group-by-spec';

export interface ConceptFilters {
  types: Set<ConceptType>;
  // Source-name filters split by kind. Empty set on either side means
  // "no constraint for that kind"; a name in either set narrows to that name.
  cubes: Set<string>;
  views: Set<string>;
  cdpProjectedOnly: boolean;
  unreferencedOnly: boolean;
  groupBy: GroupByKey;
}

export function emptyConceptFilters(): ConceptFilters {
  return {
    types: new Set(),
    cubes: new Set(),
    views: new Set(),
    cdpProjectedOnly: false,
    unreferencedOnly: false,
    groupBy: 'type',
  };
}

function refsFor(metric: BusinessMetric): string[] {
  const f = metric.formula;
  if (f.type === 'measure') return [f.ref];
  if (f.type === 'ratio') return [f.numerator, f.denominator];
  if (f.type === 'expression') return f.inputs ?? [];
  return [];
}

export function buildUsageMap(
  metrics: BusinessMetric[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of metrics) {
    for (const ref of refsFor(m)) {
      out.set(ref, (out.get(ref) ?? 0) + 1);
    }
  }
  return out;
}

function matchesQuery(concept: Concept, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    concept.fqn.toLowerCase().includes(needle) ||
    concept.name.toLowerCase().includes(needle) ||
    (concept.title?.toLowerCase().includes(needle) ?? false) ||
    (concept.description?.toLowerCase().includes(needle) ?? false)
  );
}

export interface FilteredConceptsResult {
  visible: Concept[];
  totalCount: number;
  usageMap: Map<string, number>;
}

export function useFilteredConcepts(
  concepts: Concept[],
  filters: ConceptFilters,
  query: string,
  businessMetrics: BusinessMetric[],
): FilteredConceptsResult {
  return useMemo(() => {
    const usageMap = buildUsageMap(businessMetrics);

    // Cube/View source-name filters apply per kind. When at least one side has
    // a selection, only concepts from a *selected* source on that side survive;
    // the untouched side stays fully open. When both sides have selections,
    // concepts pass if they match either side.
    const cubeFilterActive = filters.cubes.size > 0 || filters.views.size > 0;

    const visible = concepts.filter((c) => {
      if (filters.types.size > 0 && !filters.types.has(c.type)) return false;
      if (cubeFilterActive) {
        const target = c.cubeKind === 'view' ? filters.views : filters.cubes;
        if (!target.has(c.cube)) return false;
      }
      if (filters.cdpProjectedOnly && !c.meta?.cdpProjection) return false;
      if (filters.unreferencedOnly && (usageMap.get(c.fqn) ?? 0) > 0) return false;
      if (!matchesQuery(c, query)) return false;
      return true;
    });

    return { visible, totalCount: concepts.length, usageMap };
  }, [concepts, filters, query, businessMetrics]);
}
