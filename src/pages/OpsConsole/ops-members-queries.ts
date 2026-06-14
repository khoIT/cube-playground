/**
 * Cube query builder for the Members-tab top-payers list.
 *
 * This is intentionally kept SEPARATE from ops-overview-queries.ts: it is the
 * ONE Ops query that returns per-user rows (it carries mf_users.user_id), which
 * is mild PII. The Overview surface stays strictly aggregate-only; isolating the
 * per-user query in its own module makes that privacy boundary explicit and keeps
 * it from ever being imported into an aggregate context by accident. Surfacing
 * the list was a deliberate, user-approved product decision.
 */
import type { Query } from '@cubejs-client/core';

/** Top-N payers by lifetime value, ranked desc — powers the Members-tab list.
 *  Snapshot (no time window): LTV / tier / last-login are as-of values. */
export function topPayersQuery(limit = 50): Query {
  return {
    measures: ['mf_users.ltv_total_vnd'],
    dimensions: [
      'mf_users.user_id',
      'mf_users.ingame_name',
      'mf_users.payer_tier',
      'mf_users.last_login_date',
      'mf_users.lifetime_txn_count',
    ],
    order: { 'mf_users.ltv_total_vnd': 'desc' },
    limit,
  };
}
