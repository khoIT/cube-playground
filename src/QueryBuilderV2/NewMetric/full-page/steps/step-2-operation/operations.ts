import type { Operation } from '../../../types';

/**
 * What a single input slot can accept.
 * `numeric` — numeric columns (dimensions + measures).
 * `all`     — any column type.
 * Filter dropdown uses the sentinel `'all-dimensions'` directly in
 * `use-eligible-columns.ts`; it is not a slot accept value.
 */
export type SlotAccepts = 'numeric' | 'all';

export type InputSlot = {
  id: string;          // 'value' | 'numerator' | 'denominator' | ...
  label: string;
  accepts: SlotAccepts;
  required: boolean;
};

export type OperationDef = {
  id: Operation;
  name: string;
  formula: string;          // human-readable mono formula
  description: string;
  /** Each input slot becomes one column-picker grid in Step 3. */
  inputs: InputSlot[];
  /** Minimum selected source cubes for this op to be available in Step 2. */
  minSources: number;
  example: string;
  pro?: boolean;            // true → Advanced segment
  dontUseFor?: string;
};

const VALUE_NUMERIC: InputSlot = { id: 'value', label: 'Column', accepts: 'numeric', required: true };
const VALUE_ALL_REQUIRED: InputSlot = { id: 'value', label: 'Column', accepts: 'all', required: true };
const VALUE_ALL_OPTIONAL: InputSlot = { id: 'value', label: 'Column (optional)', accepts: 'all', required: false };

/**
 * 9 operations. Custom SQL was intentionally dropped (red-team #24).
 *
 * `inputs` declares the N-slot contract Step 3 renders. Ratio is the only
 * op that uses 2 slots today; the schema accommodates more (weighted avg,
 * formula) without re-touching Step 3.
 */
export const OPERATIONS: OperationDef[] = [
  { id: 'sum', name: 'Sum', formula: 'SUM(x)', description: 'Total of a numeric column.', minSources: 1, inputs: [VALUE_NUMERIC], example: 'Total revenue', dontUseFor: 'Counting rows — use Count instead.' },
  { id: 'count', name: 'Count', formula: 'COUNT(*)', description: 'Number of rows matching filters. Pick a column to count its non-null values, or skip to count rows.', minSources: 1, inputs: [VALUE_ALL_OPTIONAL], example: 'Active users / sessions' },
  { id: 'countDistinct', name: 'Count distinct', formula: 'COUNT(DISTINCT x)', description: 'Unique values of a column.', minSources: 1, inputs: [VALUE_ALL_REQUIRED], example: 'Distinct users' },
  { id: 'avg', name: 'Average', formula: 'AVG(x)', description: 'Arithmetic mean of a numeric column.', minSources: 1, inputs: [VALUE_NUMERIC], example: 'Avg order value' },
  { id: 'min', name: 'Min', formula: 'MIN(x)', description: 'Smallest value of a numeric or date column.', minSources: 1, inputs: [VALUE_NUMERIC], example: 'Earliest signup date' },
  { id: 'max', name: 'Max', formula: 'MAX(x)', description: 'Largest value of a numeric or date column.', minSources: 1, inputs: [VALUE_NUMERIC], example: 'Latest activity timestamp' },
  { id: 'median', name: 'Median', formula: 'PERCENTILE_CONT(0.5)', description: 'Middle value of a numeric column.', minSources: 1, inputs: [VALUE_NUMERIC], example: 'Median LTV', pro: true },
  { id: 'percentile', name: 'Percentile (P95)', formula: 'PERCENTILE_CONT(0.95)', description: '95th-percentile value of a numeric column.', minSources: 1, inputs: [VALUE_NUMERIC], example: 'P95 page load time', pro: true },
  {
    id: 'ratio',
    name: 'Ratio',
    formula: 'A / NULLIF(B, 0)',
    description: 'Ratio of two numeric measures. Sources may be the same cube or two joined cubes.',
    minSources: 2,
    inputs: [
      { id: 'numerator', label: 'Numerator', accepts: 'numeric', required: true },
      { id: 'denominator', label: 'Denominator', accepts: 'numeric', required: true },
    ],
    example: 'Conversion rate',
  },
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

/**
 * Which slot id holds the "primary" member for compat with the legacy single-
 * column flow. Used by the `useNewMetricDraft` parallel-sync to keep the
 * legacy `ofMember` field in lockstep with `inputs[primarySlotIdFor(op)]`.
 */
export function primarySlotIdFor(op: Operation | null | undefined): string {
  if (op === 'ratio') return 'numerator';
  return 'value';
}
