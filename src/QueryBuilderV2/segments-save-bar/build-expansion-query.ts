/**
 * Builds the secondary Cube Query that materializes actual user_ids for the
 * cohort rows the user selected in an aggregated Playground result.
 *
 * Strategy: keep the original query's filter scope (filters + time range),
 * drop measures, drop the time granularity (granularity is for grouping;
 * the dateRange is what bounds the filter), and constrain each selected row
 * via OR-of-AND-groups over its non-identity dimension values.
 *
 *   filters = [
 *     ...originalFilters,
 *     { or: [
 *       { and: [{ member: dim1, operator: 'equals', values: [row1.dim1] }, ...] },
 *       { and: [{ member: dim1, operator: 'equals', values: [row2.dim1] }, ...] },
 *     ] }
 *   ]
 */

import type { Query, TimeDimension } from '@cubejs-client/core';

export const UID_HARD_CAP = 5000;

interface OriginalQueryShape {
  dimensions?: string[];
  measures?: string[];
  timeDimensions?: TimeDimension[];
  filters?: unknown[];
  segments?: string[];
}

export function getNonIdentityDimensions(
  originalDimensions: string[] | undefined,
  identityField: string,
): string[] {
  return (originalDimensions ?? []).filter((d) => d !== identityField);
}

export function buildRowAndGroup(
  row: Record<string, unknown>,
  dimsToConstrain: string[],
): { and: Array<{ member: string; operator: 'equals'; values: [string] }> } | null {
  const clauses = dimsToConstrain
    .filter((dim) => row[dim] != null)
    .map((dim) => ({
      member: dim,
      operator: 'equals' as const,
      values: [String(row[dim])] as [string],
    }));
  if (clauses.length === 0) return null;
  return { and: clauses };
}

export function buildExpansionQuery(
  originalQuery: OriginalQueryShape,
  selectedRows: Record<string, unknown>[],
  identityField: string,
  uidLimit: number = UID_HARD_CAP,
): Query {
  const dimsToConstrain = getNonIdentityDimensions(originalQuery.dimensions, identityField);
  const orGroups = selectedRows
    .map((row) => buildRowAndGroup(row, dimsToConstrain))
    .filter((g): g is NonNullable<typeof g> => g != null);

  // Preserve the date range; drop granularity so the time dim acts as a pure
  // filter (we want every uid matching the range, not buckets).
  const timeDimensions = (originalQuery.timeDimensions ?? []).map((td) => ({
    dimension: td.dimension,
    ...(td.dateRange ? { dateRange: td.dateRange } : {}),
  })) as TimeDimension[];

  const filters: unknown[] = [...(originalQuery.filters ?? [])];
  if (orGroups.length > 0) {
    filters.push({ or: orGroups });
  }

  return {
    dimensions: [identityField],
    measures: [],
    timeDimensions,
    filters: filters as Query['filters'],
    segments: originalQuery.segments,
    limit: uidLimit,
  };
}
