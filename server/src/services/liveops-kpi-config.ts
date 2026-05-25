/**
 * Server-side mirror of src/pages/Liveops/kpi-config.ts.
 *
 * Kept identical in shape so the refresh job and the FE renderer agree on
 * tile ordering, ids, and which queries to issue. Format / locale lives on
 * the FE — the cache stores raw numeric series + computed deltas only.
 */

export interface KpiSpec {
  id: string;
  label: string;
  measure?: string;
  derived?: { numerator: string; denominator: string };
  timeDim: string;
  deltaWindow: '1d' | '7d';
  format?: 'number' | 'currency' | 'percent';
  invertDelta?: boolean;
}

export const KPI_CONFIG: KpiSpec[] = [
  { id: 'dau',     label: 'DAU',           measure: 'active_daily.dau',                       timeDim: 'active_daily.log_date',          deltaWindow: '1d' },
  { id: 'mau',     label: 'MAU',           measure: 'active_daily.mau',                       timeDim: 'active_daily.log_date',          deltaWindow: '7d' },
  { id: 'revenue', label: 'Revenue (VND)', measure: 'user_recharge_daily.revenue_vnd_total',  timeDim: 'user_recharge_daily.log_date', deltaWindow: '1d', format: 'currency' },
  { id: 'paying',  label: 'Paying users',  measure: 'user_recharge_daily.paying_users',       timeDim: 'user_recharge_daily.log_date', deltaWindow: '1d' },
  {
    id: 'arpdau',
    label: 'ARPDAU',
    derived: { numerator: 'user_recharge_daily.revenue_vnd_total', denominator: 'active_daily.dau' },
    timeDim: 'active_daily.log_date',
    deltaWindow: '1d',
    format: 'currency',
  },
];
