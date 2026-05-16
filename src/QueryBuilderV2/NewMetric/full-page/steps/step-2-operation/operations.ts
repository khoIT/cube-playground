import type { Operation } from '../../../types';

export type OperationAccepts = 'numeric' | 'all' | '2-numeric' | 'none';

export type OperationDef = {
  id: Operation;
  name: string;
  formula: string;          // human-readable mono formula
  description: string;
  accepts: OperationAccepts;
  example: string;
  pro?: boolean;            // true → Advanced segment
  dontUseFor?: string;
};

/**
 * 9 operations. Custom SQL was intentionally dropped (red-team #24).
 */
export const OPERATIONS: OperationDef[] = [
  { id: 'sum', name: 'Sum', formula: 'SUM(x)', description: 'Total of a numeric column.', accepts: 'numeric', example: 'Total revenue', dontUseFor: 'Counting rows — use Count instead.' },
  { id: 'count', name: 'Count', formula: 'COUNT(*)', description: 'Number of rows matching filters.', accepts: 'none', example: 'Active users / sessions' },
  { id: 'countDistinct', name: 'Count distinct', formula: 'COUNT(DISTINCT x)', description: 'Unique values of a column.', accepts: 'all', example: 'Distinct users' },
  { id: 'avg', name: 'Average', formula: 'AVG(x)', description: 'Arithmetic mean of a numeric column.', accepts: 'numeric', example: 'Avg order value' },
  { id: 'min', name: 'Min', formula: 'MIN(x)', description: 'Smallest value of a numeric or date column.', accepts: 'numeric', example: 'Earliest signup date' },
  { id: 'max', name: 'Max', formula: 'MAX(x)', description: 'Largest value of a numeric or date column.', accepts: 'numeric', example: 'Latest activity timestamp' },
  { id: 'median', name: 'Median', formula: 'PERCENTILE_CONT(0.5)', description: 'Middle value of a numeric column.', accepts: 'numeric', example: 'Median LTV', pro: true },
  { id: 'percentile', name: 'Percentile (P95)', formula: 'PERCENTILE_CONT(0.95)', description: '95th-percentile value of a numeric column.', accepts: 'numeric', example: 'P95 page load time', pro: true },
  { id: 'ratio', name: 'Ratio', formula: 'A / NULLIF(B, 0)', description: 'Ratio of two numeric measures from the same cube.', accepts: '2-numeric', example: 'Conversion rate' },
];

export type OperationSegment = 'common' | 'all' | 'advanced';

export function filterBySegment(seg: OperationSegment, defs: OperationDef[] = OPERATIONS): OperationDef[] {
  if (seg === 'common') return defs.filter((d) => !d.pro);
  if (seg === 'advanced') return defs.filter((d) => d.pro);
  return defs;
}

export function findOp(id: Operation): OperationDef | undefined {
  return OPERATIONS.find((o) => o.id === id);
}
