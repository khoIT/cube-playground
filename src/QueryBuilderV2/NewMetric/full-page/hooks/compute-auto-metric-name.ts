import type { NewMetricDraftV2 } from '../../types';

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
 *  - `count` with no column  → `count_<sourceCube>`
 *  - `ratio` with two cols   → `ratio_<a>_per_<b>`
 *  - any op with a column    → `<op>_<columnLeaf>` (member name without cube prefix)
 *  - no source picked yet    → `untitled_metric`
 *
 * The returned identifier is always lowercase snake_case; aggregate names like
 * `countDistinct` are emitted as `count_distinct` for readability.
 */
export function computeAutoMetricName(draft: NewMetricDraftV2): string {
  if (!draft.sourceCube) return 'untitled_metric';

  const op = snakeOp(draft.operation);
  const leaf = leafOf(draft.ofMember);

  if (draft.operation === 'ratio') {
    const leafB = leafOf(draft.ofMemberB);
    if (leaf && leafB) return `ratio_${leaf}_per_${leafB}`;
    if (leaf) return `ratio_${leaf}`;
    return `ratio_${draft.sourceCube}`;
  }
  if (leaf) return `${op}_${leaf}`;
  if (draft.operation === 'count') return `count_${draft.sourceCube}`;
  return `${op}_${draft.sourceCube}`;
}

/**
 * Human-readable title companion to {@link computeAutoMetricName}. Returns
 * e.g. `Sum of revenue`, `Distinct count of country`, `Count rows`.
 */
export function computeAutoMetricTitle(draft: NewMetricDraftV2): string {
  if (!draft.sourceCube || !draft.operation) return '';

  const opTitle = OPERATION_TITLES[draft.operation] ?? draft.operation;
  const humanize = (m: string | null | undefined) => leafOf(m).replace(/_/g, ' ').trim();

  if (draft.operation === 'ratio') {
    const a = humanize(draft.ofMember);
    const b = humanize(draft.ofMemberB);
    if (a && b) return `Ratio of ${a} per ${b}`;
    if (a) return `Ratio of ${a}`;
    return 'Ratio';
  }

  const colHuman = humanize(draft.ofMember);
  if (colHuman) return `${opTitle} of ${colHuman}`;
  if (draft.operation === 'count') return `Count of ${draft.sourceCube}`;
  return opTitle;
}
