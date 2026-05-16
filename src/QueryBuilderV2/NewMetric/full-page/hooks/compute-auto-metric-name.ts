import type { NewMetricDraftV2 } from '../../types';

/**
 * Derives a default metric identifier from the draft, matching the convention
 * shown in the Stitch walkthrough (e.g. `count_ltv_30d_total_vnd`).
 *
 * Rules:
 *  - `count` with no column  → `count_<sourceCube>`
 *  - any op with a column    → `<op>_<columnLeaf>` where columnLeaf is the
 *    member name without its cube prefix (`mf_users.ltv_30d_total_vnd` →
 *    `ltv_30d_total_vnd`)
 *  - no source picked yet    → `untitled_metric`
 *
 * The returned identifier is always lowercase snake_case; aggregate names like
 * `countDistinct` are emitted as `count_distinct` for readability.
 */
export function computeAutoMetricName(draft: NewMetricDraftV2): string {
  if (!draft.sourceCube) return 'untitled_metric';

  const op = (draft.operation ?? 'metric').replace(/([A-Z])/g, '_$1').toLowerCase();

  const member = draft.ofMember ?? null;
  if (member) {
    const leaf = member.includes('.') ? member.split('.').slice(-1)[0] : member;
    return `${op}_${leaf}`;
  }
  if (draft.operation === 'count') {
    return `count_${draft.sourceCube}`;
  }
  return `${op}_${draft.sourceCube}`;
}
