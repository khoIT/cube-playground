/**
 * diff-equality.ts
 * Pure compare of `CdpMetricPayload` (expected, derived locally by
 * `projectMeasure`) vs the record returned by GET /cdp/v1/metrics/...
 *
 * Compared:   metric_codename, source, expression, filter, dimensions
 * Ignored:    materialize, schedule, created_at, updated_at
 * Normalize:  trim + collapse whitespace on `expression`; null/undefined
 *             filter == "" ; dimensions order-independent (sort).
 */

import type { CdpMetricPayload, VerifyDiffEntry } from './types';

const COMPARED_FIELDS = ['metric_codename', 'source', 'expression', 'dimensions', 'filter'] as const;

function normalizeExpression(s: unknown): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeFilter(s: unknown): string {
  return s == null ? '' : String(s);
}

function normalizeDimensions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...value].map(String).sort();
}

export function diffEquality(
  expected: CdpMetricPayload,
  actual: Record<string, unknown>,
): VerifyDiffEntry[] {
  const out: VerifyDiffEntry[] = [];
  for (const field of COMPARED_FIELDS) {
    const e = expected[field];
    const a = actual[field];
    if (!fieldsEqual(field, e, a)) {
      out.push({ field, expected: e, actual: a });
    }
  }
  return out;
}

function fieldsEqual(field: string, expected: unknown, actual: unknown): boolean {
  if (field === 'expression') {
    return normalizeExpression(expected) === normalizeExpression(actual);
  }
  if (field === 'filter') {
    return normalizeFilter(expected) === normalizeFilter(actual);
  }
  if (field === 'dimensions') {
    const e = normalizeDimensions(expected);
    const a = normalizeDimensions(actual);
    if (e.length !== a.length) return false;
    return e.every((v, i) => v === a[i]);
  }
  return expected === actual;
}
