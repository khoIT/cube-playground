/**
 * Alert rule engine — evaluates threshold/condition rules on the cron tick.
 *
 * Rules are stored in the alert_rules table (migration 071). Each rule names a
 * Cube measure, comparator, and threshold; the engine queries the measure's
 * latest value via the existing Cube path, compares, and fires an in-app
 * notification on breach.
 *
 * Throttle: a rule cannot re-fire for the same owner within the same calendar
 * day. This is enforced via last_fired_date stored in a transient in-memory
 * map (sufficient for single-instance; cleared on restart).
 *
 * Metric querying: the engine issues a Cube /load for `measures=[metric]` over
 * the last 2 days (granularity: day) and compares the most-recent data point.
 * If no data comes back, the rule does NOT fire — we never invent a breach.
 */

import { load } from './cube-client.js';
import { resolveCubeTokenForGame } from './resolve-cube-token.js';
import { sendNotification } from './notify-client.js';
import { getDb } from '../db/sqlite.js';

export interface AlertRule {
  id: number;
  owner: string;
  game: string;
  metric: string;
  comparator: '<' | '>' | '<=' | '>=' | 'pct_drop' | 'pct_rise';
  threshold: number;
  window: string | null;
  channel: string;
  enabled: number;
  created_at: number;
}

/** In-memory throttle: `${ruleId}:${YYYY-MM-DD}` → true (fired today). */
const firedToday = new Map<string, boolean>();

function todayKey(ruleId: number): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${ruleId}:${date}`;
}

function loadEnabledRules(): AlertRule[] {
  try {
    const db = getDb();
    return db
      .prepare(`SELECT * FROM alert_rules WHERE enabled = 1 ORDER BY id`)
      .all() as AlertRule[];
  } catch {
    // Table not migrated yet — no-op.
    return [];
  }
}

interface CubeLoadResult {
  data: Array<Record<string, unknown>>;
}

function asNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Query the most recent 2 data points for the rule's metric via Cube.
 * Returns [prev, latest] or null when data is insufficient.
 */
async function fetchLatestValues(
  rule: AlertRule,
): Promise<{ latest: number; prev: number | null } | null> {
  const token = resolveCubeTokenForGame(rule.game);
  if (!token) return null;

  // Determine the time dimension from the metric name:
  // e.g. "active_daily.dau" → time dim = "active_daily.log_date".
  // Convention: <cube>.<measure> → <cube>.log_date as default time dim.
  const [cubeName] = rule.metric.split('.');
  const timeDim = `${cubeName}.log_date`;

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 7); // 7-day window ensures ≥1 data point

  const query = {
    measures: [rule.metric],
    timeDimensions: [
      {
        dimension: timeDim,
        granularity: 'day',
        dateRange: [startDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10)],
      },
    ],
    order: { [timeDim]: 'desc' },
    limit: 2,
  };

  try {
    const res = (await load(query, token, 15_000)) as CubeLoadResult;
    const rows = res.data ?? [];
    if (rows.length === 0) return null;

    const latestVal = asNumber(rows[0][rule.metric]);
    if (latestVal == null) return null;

    const prevVal = rows.length > 1 ? asNumber(rows[1][rule.metric]) : null;
    return { latest: latestVal, prev: prevVal };
  } catch (err) {
    console.warn(
      `[alert-rule-engine] Cube query failed for rule ${rule.id} (${rule.game}/${rule.metric}): ${(err as Error).message}`,
    );
    return null;
  }
}

/**
 * Returns true when `value` breaches the rule's comparator + threshold.
 * pct_drop / pct_rise are evaluated as percentage change from prev to latest.
 */
function isBreach(
  rule: AlertRule,
  latest: number,
  prev: number | null,
): boolean {
  const t = rule.threshold;
  switch (rule.comparator) {
    case '<':  return latest < t;
    case '>':  return latest > t;
    case '<=': return latest <= t;
    case '>=': return latest >= t;
    case 'pct_drop': {
      if (prev == null || prev === 0) return false;
      const pct = ((prev - latest) / Math.abs(prev)) * 100;
      return pct >= t; // positive pct_drop = how much it fell
    }
    case 'pct_rise': {
      if (prev == null || prev === 0) return false;
      const pct = ((latest - prev) / Math.abs(prev)) * 100;
      return pct >= t;
    }
    default:
      return false;
  }
}

/**
 * Evaluate all enabled alert rules. Called from the cron tick via
 * `maybeRunAlertRules()`. Errors per-rule are caught and logged — a single
 * bad rule must not abort evaluation of the remaining rules.
 */
export async function evaluateAlertRules(
  warn: (msg: string) => void = (m) => console.warn(m),
): Promise<{ evaluated: number; breached: number; notified: number }> {
  const rules = loadEnabledRules();
  let evaluated = 0;
  let breached = 0;
  let notified = 0;

  for (const rule of rules) {
    // Per-owner per-rule daily throttle — skip if already fired today.
    const key = todayKey(rule.id);
    if (firedToday.get(key)) continue;

    try {
      const vals = await fetchLatestValues(rule);
      evaluated++;

      if (!vals) continue; // no data → rule does not fire

      if (!isBreach(rule, vals.latest, vals.prev)) continue;

      breached++;

      // Mark throttle before the async notify so concurrent ticks don't double-fire.
      firedToday.set(key, true);

      const deltaPct =
        vals.prev != null && vals.prev !== 0
          ? Math.round(((vals.latest - vals.prev) / Math.abs(vals.prev)) * 1000) / 10
          : null;

      const ok = await sendNotification({
        ownerId: rule.owner,
        kind: 'alert_rule_breach',
        payload: {
          ruleId: rule.id,
          game: rule.game,
          metric: rule.metric,
          comparator: rule.comparator,
          threshold: rule.threshold,
          latest: vals.latest,
          prev: vals.prev,
          deltaPct,
        },
      });

      if (ok) notified++;
      else warn(`[alert-rule-engine] notification delivery failed for rule ${rule.id}`);
    } catch (err) {
      warn(`[alert-rule-engine] rule ${rule.id} evaluation error: ${(err as Error).message}`);
    }
  }

  return { evaluated, breached, notified };
}

/** Interval guard: only one evaluation runs at a time. */
let evaluating = false;
let lastEvalAt = 0;
const EVAL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes between evaluations

/**
 * Called from the cron tick every 60s. Self-gates on a 5-minute interval so
 * the rule engine doesn't hammer Cube — rules are not real-time, 5-minute
 * granularity is operationally reasonable.
 */
export async function maybeRunAlertRules(
  now: number = Date.now(),
  warn: (msg: string) => void = (m) => console.warn(m),
): Promise<void> {
  if (process.env.ALERT_RULES_ENABLED === '0') return;
  if (evaluating) return;
  if (now - lastEvalAt < EVAL_INTERVAL_MS) return;

  evaluating = true;
  try {
    const result = await evaluateAlertRules(warn);
    lastEvalAt = Date.now();
    if (result.breached > 0) {
      console.log(
        `[alert-rule-engine] evaluated=${result.evaluated} breached=${result.breached} notified=${result.notified}`,
      );
    }
  } catch (err) {
    warn(`[alert-rule-engine] evaluation run failed: ${(err as Error).message}`);
  } finally {
    evaluating = false;
  }
}

/** Exposed for tests. */
export function __resetAlertRuleEngineState(): void {
  firedToday.clear();
  evaluating = false;
  lastEvalAt = 0;
}
