import type { NewMetricDraftV2 } from '../../types';
import { primarySlotIdFor } from '../steps/step-2-operation/operations';

const OPERATION_TITLES: Record<string, string> = {
  sum: 'Sum',
  count: 'Count',
  countDistinct: 'Distinct count',
  avg: 'Average',
  min: 'Min',
  max: 'Max',
  median: 'Median',
  percentile: 'P95',
  ratio: 'Ratio',
  weightedAvg: 'Weighted average',
  formula: 'Formula',
};

function leafOf(member: string | null | undefined): string {
  if (!member) return '';
  return member.includes('.') ? member.split('.').slice(-1)[0] : member;
}

function snakeOp(op: string | null | undefined): string {
  return (op ?? 'metric').replace(/([A-Z])/g, '_$1').toLowerCase();
}

/**
 * Derives a default metric identifier from the draft, matching the convention
 * shown in the Stitch walkthrough (e.g. `count_ltv_30d_total_vnd`).
 *
 * Rules:
 *  - no source picked yet    → `untitled_metric`
 *  - `ratio` with two cols   → `ratio_<numerator>_per_<denominator>`
 *  - any op with a column    → `<op>_<columnLeaf>`
 *  - `count` with no column  → `count_<primaryCube>`
 *
 * The returned identifier is always lowercase snake_case; aggregate names like
 * `countDistinct` are emitted as `count_distinct` for readability. Multi-source
 * drafts use the primary cube (`sourceCubes[0]`) for the fallback name.
 */
export function computeAutoMetricName(draft: NewMetricDraftV2): string {
  const primaryCube = draft.sourceCubes[0] ?? null;
  if (!primaryCube) return 'untitled_metric';

  const op = snakeOp(draft.operation);

  if (draft.operation === 'ratio') {
    const numerator = leafOf(draft.inputs.numerator);
    const denominator = leafOf(draft.inputs.denominator);
    if (numerator && denominator) return `ratio_${numerator}_per_${denominator}`;
    if (numerator) return `ratio_${numerator}`;
    return `ratio_${primaryCube}`;
  }

  const primarySlot = primarySlotIdFor(draft.operation);
  const leaf = leafOf(draft.inputs[primarySlot]);
  if (leaf) return `${op}_${leaf}`;
  if (draft.operation === 'count') return `count_${primaryCube}`;
  return `${op}_${primaryCube}`;
}

/**
 * Human-readable title companion to {@link computeAutoMetricName}. Returns
 * e.g. `Sum of revenue`, `Distinct count of country`, `Ratio of a per b`.
 */
export function computeAutoMetricTitle(draft: NewMetricDraftV2): string {
  const primaryCube = draft.sourceCubes[0] ?? null;
  if (!primaryCube || !draft.operation) return '';

  const opTitle = OPERATION_TITLES[draft.operation] ?? draft.operation;
  const humanize = (m: string | null | undefined) => leafOf(m).replace(/_/g, ' ').trim();

  if (draft.operation === 'ratio') {
    const a = humanize(draft.inputs.numerator);
    const b = humanize(draft.inputs.denominator);
    if (a && b) return `Ratio of ${a} per ${b}`;
    if (a) return `Ratio of ${a}`;
    return 'Ratio';
  }

  const primarySlot = primarySlotIdFor(draft.operation);
  const colHuman = humanize(draft.inputs[primarySlot]);
  if (colHuman) return `${opTitle} of ${colHuman}`;
  if (draft.operation === 'count') return `Count of ${primaryCube}`;
  return opTitle;
}
