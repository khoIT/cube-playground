/**
 * KPI definitions for the Live KPI hero strip.
 * Measure names verified against cube-dev YAML for active games.
 *
 * Gap notes:
 *   - muaw + ptg only have recharge.yml — active_daily cube absent for those games.
 *     KPIs that reference active_daily (DAU, MAU, ARPDAU) render "—" for those games.
 *   - ARPDAU is client-derived: numerator / denominator, merged by date.
 */

export type KpiSpec = {
  id: string;
  label: string;
  /** Single direct measure. Mutually exclusive with `derived`. */
  measure?: string;
  /** Derived ratio — two separate queries merged by date. */
  derived?: { numerator: string; denominator: string };
  timeDim: string;
  deltaWindow: '1d' | '7d';
  format?: 'number' | 'currency' | 'percent';
  /** When true, a positive delta is "bad" (red). Unused in current 5-KPI set. */
  invertDelta?: boolean;
};

export const KPI_CONFIG: KpiSpec[] = [
  {
    id: 'dau',
    label: 'DAU',
    measure: 'active_daily.dau',
    timeDim: 'active_daily.log_date',
    deltaWindow: '1d',
  },
  {
    id: 'mau',
    label: 'MAU',
    measure: 'active_daily.mau',
    timeDim: 'active_daily.log_date',
    deltaWindow: '7d',
  },
  {
    id: 'revenue',
    label: 'Revenue (VND)',
    measure: 'user_recharge_daily.revenue_vnd_total',
    timeDim: 'user_recharge_daily.log_date',
    deltaWindow: '1d',
    format: 'currency',
  },
  {
    id: 'paying',
    label: 'Paying users',
    measure: 'user_recharge_daily.paying_users',
    timeDim: 'user_recharge_daily.log_date',
    deltaWindow: '1d',
  },
  {
    id: 'arpdau',
    label: 'ARPDAU',
    derived: {
      numerator: 'user_recharge_daily.revenue_vnd_total',
      denominator: 'active_daily.dau',
    },
    timeDim: 'active_daily.log_date',
    deltaWindow: '1d',
    format: 'currency',
  },
];
