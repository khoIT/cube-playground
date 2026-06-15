/**
 * Real treatment-vs-hold-out outcomes, read through the `billing_detail` cube
 * (semantic layer) — NOT a raw Trino reader. The cube already encodes the
 * per-game product-code gate (cfm A49 / jus A70) and the real-users mf_users
 * semi-join, so this reader just supplies the arm's uid IN-list + the window and
 * aggregates the returned gross.
 *
 * Currency: cfm A49 is VND-only; jus A70 is mixed USD+VND. Rows are grouped by
 * the `currency` dim and USD gross is normalized to VND at EXPERIMENT_USD_TO_VND
 * (default 25000) so arm totals are a single comparable VND figure. Currencies
 * seen are surfaced so the UI can label a mixed-currency readout.
 *
 * PII: selects only user_id + numeric gross/txn measures + currency. No contact
 * columns exist on this cube; the column list here is the enforced allow-list.
 */

import type { WorkspaceCtx } from '../services/cube-client.js';
import { loadWithContinueWait } from '../services/load-with-continue-wait.js';
import type {
  ArmOutcome,
  ExperimentArm,
  OutcomeBundle,
  OutcomeSeriesPoint,
} from './experiment-types.js';

const GROSS = 'billing_detail.cash_charged_gross';
const TXNS = 'billing_detail.txn_count_total';
const UID_DIM = 'billing_detail.user_id';
const CURRENCY_DIM = 'billing_detail.currency';
const ORDER_DATE = 'billing_detail.order_date';

/** Cube can't take an unbounded IN-list; chunk the uid filter. */
const UID_CHUNK = 1000;
/**
 * billing_detail is a large source (58M+ rows) with no pre-agg for this
 * ad-hoc uid-filtered scan, so a cold query returns Cube's "Continue wait"
 * well past 15s. We poll through it (loadWithContinueWait) with a generous
 * budget rather than dropping the scorecard on the first cold miss.
 */
const OUTCOME_TIMEOUT_MS = 90_000;

function usdToVnd(): number {
  const raw = Number(process.env.EXPERIMENT_USD_TO_VND);
  return Number.isFinite(raw) && raw > 0 ? raw : 25_000;
}

/** Normalize one currency's gross amount to VND. */
function toVnd(currency: string | null, amount: number): number {
  if (!currency || currency.toUpperCase() === 'VND') return amount;
  if (currency.toUpperCase() === 'USD') return amount * usdToVnd();
  // Unknown currency (not expected for A49/A70) — pass through, surfaced via `currencies`.
  return amount;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function dateRange(assignedAt: string, windowDays: number): [string, string] {
  const start = assignedAt.slice(0, 10);
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const end = new Date(startMs + (windowDays - 1) * 86400000).toISOString().slice(0, 10);
  return [start, end];
}

interface GrossRow {
  [UID_DIM]: string;
  [CURRENCY_DIM]: string | null;
  [GROSS]: string | number | null;
  [TXNS]: string | number | null;
}

function num(v: string | number | null | undefined): number {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? Number(n) : 0;
}

/**
 * Aggregate one arm's gross over the window. Groups the per-user-per-currency
 * rows to per-user VND totals, then to the arm aggregate.
 */
async function readArm(
  ctx: WorkspaceCtx,
  arm: ExperimentArm,
  uids: string[],
  range: [string, string],
  currencies: Set<string>,
): Promise<ArmOutcome> {
  const perUserGross = new Map<string, number>();
  let txns = 0;

  for (const part of chunk(uids, UID_CHUNK)) {
    const query = {
      measures: [GROSS, TXNS],
      dimensions: [UID_DIM, CURRENCY_DIM],
      filters: [{ member: UID_DIM, operator: 'equals', values: part }],
      timeDimensions: [{ dimension: ORDER_DATE, dateRange: range }],
      limit: 50_000,
    };
    const res = (await loadWithContinueWait(query, undefined, OUTCOME_TIMEOUT_MS, ctx)) as { data?: GrossRow[] };
    for (const row of res.data ?? []) {
      const uid = String(row[UID_DIM]);
      const currency = row[CURRENCY_DIM];
      if (currency) currencies.add(String(currency).toUpperCase());
      const vnd = toVnd(currency, num(row[GROSS]));
      perUserGross.set(uid, (perUserGross.get(uid) ?? 0) + vnd);
      txns += num(row[TXNS]);
    }
  }

  let grossVnd = 0;
  let payers = 0;
  for (const g of perUserGross.values()) {
    grossVnd += g;
    if (g > 0) payers += 1;
  }

  return { arm, assigned: uids.length, payers, grossVnd, txns };
}

/**
 * Per-arm daily cumulative gross series for the chart. One arm-aggregated query
 * per arm (no per-uid rows) keyed by day, then accumulated.
 */
async function readSeries(
  ctx: WorkspaceCtx,
  treatmentUids: string[],
  controlUids: string[],
  range: [string, string],
): Promise<OutcomeSeriesPoint[]> {
  async function dailyByArm(uids: string[]): Promise<Map<string, number>> {
    const byDay = new Map<string, number>();
    for (const part of chunk(uids, UID_CHUNK)) {
      const query = {
        measures: [GROSS],
        dimensions: [CURRENCY_DIM],
        filters: [{ member: UID_DIM, operator: 'equals', values: part }],
        timeDimensions: [{ dimension: ORDER_DATE, dateRange: range, granularity: 'day' }],
        limit: 50_000,
      };
      const res = (await loadWithContinueWait(query, undefined, OUTCOME_TIMEOUT_MS, ctx)) as {
        data?: Record<string, string | number | null>[];
      };
      for (const row of res.data ?? []) {
        const day = String(row[`${ORDER_DATE}.day`] ?? row[ORDER_DATE] ?? '').slice(0, 10);
        if (!day) continue;
        const vnd = toVnd(row[CURRENCY_DIM] as string | null, num(row[GROSS]));
        byDay.set(day, (byDay.get(day) ?? 0) + vnd);
      }
    }
    return byDay;
  }

  const [tDay, cDay] = await Promise.all([dailyByArm(treatmentUids), dailyByArm(controlUids)]);
  const days = Array.from(new Set([...tDay.keys(), ...cDay.keys()])).sort();
  let tCum = 0;
  let cCum = 0;
  return days.map((date) => {
    tCum += tDay.get(date) ?? 0;
    cCum += cDay.get(date) ?? 0;
    return { date, treatmentGrossVnd: tCum, controlGrossVnd: cCum };
  });
}

/** Read both arms' outcomes + the daily series over the measurement window. */
export async function readOutcomes(
  ctx: WorkspaceCtx,
  treatmentUids: string[],
  controlUids: string[],
  assignedAt: string,
  windowDays: number,
): Promise<OutcomeBundle> {
  const range = dateRange(assignedAt, windowDays);
  const currencies = new Set<string>();
  const [treatment, control] = await Promise.all([
    readArm(ctx, 'treatment', treatmentUids, range, currencies),
    readArm(ctx, 'control', controlUids, range, currencies),
  ]);
  const series = await readSeries(ctx, treatmentUids, controlUids, range);
  return { arms: [treatment, control], series, currencies: Array.from(currencies).sort() };
}
