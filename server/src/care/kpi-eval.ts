/**
 * KPI auto-eval: after a treated case's KPI window elapses, recompute its watched
 * metric and resolve the case (kpi_met / kpi_missed), feeding the monitor's
 * attainment %. Also flags SLA breaches (treated too long after opened).
 *
 * Pure helpers (`resolveKpiOutcome`, `detectSlaBreach`) are unit-testable; the
 * job's metric recompute is injected so it runs without Cube in tests. Long KPI
 * windows (30–90d) mean the job must be idempotent — it only touches `treated`
 * cases whose `kpi_eval_at` has passed, and moves them to `resolved`, so a
 * re-run never double-resolves.
 */

import { listCases, patchCase, type CareCase, type CaseOutcome } from './care-case-store.js';

/**
 * Decide a KPI outcome from a recomputed metric value vs a numeric target.
 * Returns 'na' when the target isn't a parseable threshold (qualitative KPIs
 * are resolved by a human, not auto-evaluated).
 */
export function resolveKpiOutcome(target: string | null, metricValue: number | null): CaseOutcome {
  if (metricValue == null) return 'na';
  const parsed = parseNumericTarget(target);
  if (parsed == null) return 'na';
  // Convention: target is a floor the metric must meet/exceed to count as met.
  return metricValue >= parsed.value ? 'kpi_met' : 'kpi_missed';
}

/**
 * Extract a numeric threshold from a target — but ONLY when the target is an
 * explicit threshold, not prose that merely contains a number. Qualitative KPIs
 * ("second deposit within 7d", "no refund") return null → resolved 'na' by a
 * human, never auto-evaluated against the embedded "7".
 *
 * Recognized: a pure number ("500000"), or a number following a comparator
 * (≥/>=/≤/<=/>/</=, e.g. "ARPU ≥ 500000").
 */
function parseNumericTarget(target: string | null): { value: number } | null {
  if (!target) return null;
  const cleaned = target.replace(/,/g, '').trim();

  // Pure number.
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) return { value: Number(cleaned) };

  // Number immediately after a comparator.
  const m = cleaned.match(/(?:>=|<=|≥|≤|>|<|=)\s*(-?\d+(\.\d+)?)/);
  if (m) {
    const value = Number(m[1]);
    return Number.isFinite(value) ? { value } : null;
  }
  return null;
}

/** A case breached SLA if treatment landed (or hasn't) later than slaMinutes after open. */
export function detectSlaBreach(c: Pick<CareCase, 'opened_at' | 'treated_at'>, slaMinutes: number | undefined, now: Date): boolean {
  if (!slaMinutes) return false;
  const opened = Date.parse(c.opened_at);
  if (!Number.isFinite(opened)) return false;
  const deadline = opened + slaMinutes * 60_000;
  const end = c.treated_at ? Date.parse(c.treated_at) : now.getTime();
  return end > deadline;
}

export interface KpiEvalDeps {
  /** Recompute the watched metric for a treated case; null = unknown/unreachable. */
  fetchMetricValue: (c: CareCase) => Promise<number | null>;
}

export interface KpiEvalSummary {
  evaluated: number;
  met: number;
  missed: number;
  na: number;
}

/**
 * Resolve every treated case for a game whose KPI window has elapsed.
 * `now` and `deps` are injected for testability.
 */
export async function runKpiEval(gameId: string, deps: KpiEvalDeps, now: Date = new Date()): Promise<KpiEvalSummary> {
  const treated = listCases({ gameId, status: 'treated' });
  const due = treated.filter((c) => c.kpi_eval_at != null && Date.parse(c.kpi_eval_at) <= now.getTime());

  const summary: KpiEvalSummary = { evaluated: 0, met: 0, missed: 0, na: 0 };
  for (const c of due) {
    const value = await deps.fetchMetricValue(c);
    const outcome = resolveKpiOutcome(c.kpi_target, value);
    patchCase(c.id, { status: 'resolved', outcome });
    summary.evaluated++;
    if (outcome === 'kpi_met') summary.met++;
    else if (outcome === 'kpi_missed') summary.missed++;
    else summary.na++;
  }
  return summary;
}
