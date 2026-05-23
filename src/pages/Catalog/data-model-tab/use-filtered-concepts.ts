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

export interface ConceptFilters {
  types: Set<ConceptType>;
  cubes: Set<string>;
  cdpProjectedOnly: boolean;
  unreferencedOnly: boolean;
}

export function emptyConceptFilters(): ConceptFilters {
  return {
    types: new Set(),
    cubes: new Set(),
    cdpProjectedOnly: false,
    unreferencedOnly: false,
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

    const visible = concepts.filter((c) => {
      if (filters.types.size > 0 && !filters.types.has(c.type)) return false;
      if (filters.cubes.size > 0 && !filters.cubes.has(c.cube)) return false;
      if (filters.cdpProjectedOnly && !c.meta?.cdpProjection) return false;
      if (filters.unreferencedOnly && (usageMap.get(c.fqn) ?? 0) > 0) return false;
      if (!matchesQuery(c, query)) return false;
      return true;
    });

    return { visible, totalCount: concepts.length, usageMap };
  }, [concepts, filters, query, businessMetrics]);
}
