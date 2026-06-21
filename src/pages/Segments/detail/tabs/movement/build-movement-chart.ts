/**
 * Converts the Phase-6 movement read payloads into the ChartArtifact shape
 * AssistantChartSection renders. We reuse the chat chart renderer (the project
 * standard — "do not hand-roll charts") rather than drawing SVG here, so the
 * line↔bar / table / CSV view menu comes for free.
 *
 * Series carrying multiple lines (KPI metrics, member/entered/exited) are
 * emitted in long form `{ ts, <seriesCol>, value }` so the renderer's
 * multi-line ⇄ grouped/stacked-bar pivot works and the type toggle stays clean.
 */

import type { ChartArtifact, ChartSpec } from '../../../../../api/chat-sse-client';
import type {
  DistributionRow,
  KpiTrendSeries,
  MovementPoint,
} from '../../../../../api/segment-movement-client';

/** Humanise a snake/camel metric id for legend + tooltip text. */
export function prettifyKey(key: string): string {
  const spaced = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Short metric label: drops a leading cube prefix ("mf_users.paying_users_30d"
 * → "Paying users 30d") so the chip text matches the chart legend, which the
 * renderer already humanises off the member leaf. Keeps the selector chips and
 * the legend reading identically instead of "Mf users.paying users 30d" vs
 * "Paying users 30d".
 */
export function shortMetricLabel(key: string): string {
  const leaf = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key;
  return prettifyKey(leaf);
}

function artifact(id: string, spec: ChartSpec, rowCount: number): ChartArtifact {
  return { id, spec, truncated: false, originalRowCount: rowCount };
}

/** KPI metrics → one multi-line series per metric (long form). */
export function buildKpiTrendChart(id: string, title: string, series: KpiTrendSeries[]): ChartArtifact {
  const data: Array<Record<string, string | number>> = [];
  for (const s of series) {
    const label = shortMetricLabel(s.metricId);
    for (const p of s.points) {
      if (p.value == null) continue;
      data.push({ ts: p.ts, metric: label, value: p.value });
    }
  }
  const single = series.length <= 1;
  const spec: ChartSpec = {
    type: single ? 'line' : 'multi-line',
    title,
    data,
    encoding: single
      ? { category: 'ts', value: 'value' }
      : { category: 'ts', value: 'value', series: 'metric' },
  };
  return artifact(`${id}-kpi-trend`, spec, data.length);
}

/** member_count / entered / exited → three lines over the time axis. */
export function buildMembershipChart(id: string, title: string, points: MovementPoint[]): ChartArtifact {
  const data: Array<Record<string, string | number>> = [];
  for (const p of points) {
    if (p.memberCount != null) data.push({ ts: p.ts, series: 'Members', value: p.memberCount });
    if (p.entered != null) data.push({ ts: p.ts, series: 'Entered', value: p.entered });
    if (p.exited != null) data.push({ ts: p.ts, series: 'Exited', value: p.exited });
  }
  const spec: ChartSpec = {
    type: 'multi-line',
    title,
    data,
    encoding: { category: 'ts', value: 'value', series: 'series' },
  };
  return artifact(`${id}-movement`, spec, data.length);
}

/** Wide distribution rows → long `{ ts, bucket, count }` for a stacked bar. */
export function buildDistributionChart(
  id: string,
  title: string,
  rows: DistributionRow[],
): ChartArtifact {
  const data: Array<Record<string, string | number>> = [];
  for (const row of rows) {
    for (const [key, val] of Object.entries(row)) {
      if (key === 'ts') continue;
      data.push({ ts: row.ts, bucket: prettifyKey(key), count: Number(val) || 0 });
    }
  }
  const spec: ChartSpec = {
    type: 'stacked-bar',
    title,
    data,
    encoding: { category: 'ts', value: 'count', series: 'bucket' },
  };
  return artifact(`${id}-distribution`, spec, data.length);
}
