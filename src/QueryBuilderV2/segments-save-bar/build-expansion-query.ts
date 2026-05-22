/**
 * Builds the secondary Cube Query that materializes actual user_ids for the
 * cohort rows the user selected in an aggregated Playground result.
 *
 * Strategy: keep the original query's filter scope (filters + time range),
 * drop measures, drop the time granularity (granularity is for grouping;
 * the dateRange is what bounds the filter), and constrain each selected row
 * via OR-of-AND-groups over:
 *   - its non-identity plain dimension values (equals), and
 *   - its bucketed time-dimension values (inDateRange computed from the
 *     bucket-start timestamp + granularity).
 *
 *   filters = [
 *     ...originalFilters,
 *     { or: [
 *       { and: [
 *         { member: dim1, operator: 'equals', values: [row1.dim1] },
 *         { member: timeDim1, operator: 'inDateRange', values: [[start, end]] },
 *         ...
 *       ] },
 *       { and: [...] },
 *     ] }
 *   ]
 */

import type { Query, TimeDimension, TimeDimensionGranularity } from '@cubejs-client/core';
import { bucketDateRange } from './bucket-range';

export const UID_HARD_CAP = 5000;

interface OriginalQueryShape {
  dimensions?: string[];
  measures?: string[];
  timeDimensions?: TimeDimension[];
  filters?: unknown[];
  segments?: string[];
}

type EqualsClause = { member: string; operator: 'equals'; values: [string] };
// Cube's inDateRange filter takes a FLAT two-element string array
// (`[start, end]`), not a nested array. Mirrors the @cubejs-client/core
// `BinaryFilter.values: string[]` contract.
type InDateRangeClause = {
  member: string;
  operator: 'inDateRange';
  values: [string, string];
};
type RowClause = EqualsClause | InDateRangeClause;

export function getNonIdentityDimensions(
  originalDimensions: string[] | undefined,
  identityField: string,
): string[] {
  return (originalDimensions ?? []).filter((d) => d !== identityField);
}

/** Bucketed time dims expose `<member>.<granularity>` keys in row data. */
interface CohortTimeDim {
  member: string;
  rowKey: string;
  granularity: TimeDimensionGranularity | string;
}

export function getCohortTimeDimensions(
  originalTimeDimensions: TimeDimension[] | undefined,
  identityField: string,
): CohortTimeDim[] {
  return (originalTimeDimensions ?? [])
    .filter((td) => !!td.granularity && td.dimension !== identityField)
    .map((td) => ({
      member: td.dimension,
      rowKey: `${td.dimension}.${td.granularity}`,
      granularity: td.granularity as TimeDimensionGranularity,
    }));
}

export function buildRowAndGroup(
  row: Record<string, unknown>,
  dimsToConstrain: string[],
  cohortTimeDims: CohortTimeDim[] = [],
): { and: RowClause[] } | null {
  const equalsClauses: EqualsClause[] = dimsToConstrain
    .filter((dim) => row[dim] != null)
    .map((dim) => ({
      member: dim,
      operator: 'equals' as const,
      values: [String(row[dim])] as [string],
    }));

  const timeClauses: InDateRangeClause[] = [];
  for (const td of cohortTimeDims) {
    const range = bucketDateRange(row[td.rowKey], td.granularity);
    if (range) {
      timeClauses.push({
        member: td.member,
        operator: 'inDateRange',
        values: range,
      });
    }
  }

  const clauses: RowClause[] = [...equalsClauses, ...timeClauses];
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
  const cohortTimeDims = getCohortTimeDimensions(originalQuery.timeDimensions, identityField);
  const orGroups = selectedRows
    .map((row) => buildRowAndGroup(row, dimsToConstrain, cohortTimeDims))
    .filter((g): g is NonNullable<typeof g> => g != null);

  // Preserve the date range; drop granularity so the time dim acts as a pure
  // filter (we want every uid matching the range, not buckets). Per-row
  // bucket constraints are encoded in the OR-of-AND filter instead.
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
