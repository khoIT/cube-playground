/**
 * Headline KPI deltas — the per-card "vs yesterday" movement shown on the top
 * stats strip. One daily kpi-trend read (latest vs previous daily snapshot)
 * folded into a map keyed by headline KPI spec id, plus a synthetic 'size' from
 * member_count. Empty for non-snapshot segments (no lakehouse history).
 *
 * This is the single source of the headline deltas: the Monitor tab no longer
 * renders a duplicate KPI row — its movement detail now rides the top strip.
 */

import { useMemo } from 'react';
import {
  segmentMovementClient,
  type KpiTrendSeries,
} from '../../../../api/segment-movement-client';
import type { Preset } from '../../presets/types';
import type { Segment } from '../../../../types/segment-api';
import { useMovementResource } from '../tabs/movement/use-movement-resource';
import { defaultRange } from '../tabs/monitor/monitor-range';

export type DeltaTone = 'positive' | 'negative' | 'neutral';
export interface HeadlineDelta {
  text: string;
  tone: DeltaTone;
}

/** Last two finite numbers (prev, last) in a ts-ascending list. */
function lastTwo(values: Array<number | null | undefined>): { prev: number | null; last: number | null } {
  let prev: number | null = null;
  let last: number | null = null;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      prev = last;
      last = v;
    }
  }
  return { prev, last };
}

/** Day-over-day change for one KPI as a tinted "▲ 1.6% vs yesterday" string.
 *  Percent-format metrics report a point-change (pp); everything else a %. */
function deltaFor(prev: number | null, last: number | null, isPercent: boolean): HeadlineDelta | null {
  if (prev === null || last === null) return null;
  const diff = last - prev;
  const tone: DeltaTone = diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral';
  const sign = diff > 0 ? '▲' : diff < 0 ? '▼' : '→';
  const magnitude = isPercent
    ? `${Math.abs(diff * 100).toFixed(1)}pp`
    : `${Math.abs(prev !== 0 ? (diff / Math.abs(prev)) * 100 : 0).toFixed(1)}%`;
  return { text: `${sign} ${magnitude} vs yesterday`, tone };
}

/** Map of headline KPI id → its vs-yesterday delta. Snapshot-eligible segments
 *  only; otherwise an empty map (callers render no delta). Nullable segment so
 *  the hook can be called before the detail view resolves (rules of hooks). */
export function useHeadlineDeltas(segment: Segment | null, preset: Preset | null): Map<string, HeadlineDelta> {
  const enabled = Boolean(segment && segment.type === 'predicate' && segment.game_id);
  const segId = segment?.id ?? '';
  const range = defaultRange();
  const { data } = useMovementResource(
    () =>
      enabled
        ? segmentMovementClient.kpiTrend(segId, {
            granularity: 'daily',
            from: range.from,
            to: range.to,
          })
        : Promise.resolve(null),
    [segId, enabled, range.from, range.to],
  );

  return useMemo(() => {
    const out = new Map<string, HeadlineDelta>();
    if (!data) return out;

    const byMeasure = new Map<string, KpiTrendSeries>();
    for (const s of data.series) byMeasure.set(s.metricId, s);

    // SIZE rides member_count on every KPI row — fold into one ts→count series.
    const countByTs = new Map<string, number>();
    for (const s of data.series) {
      for (const p of s.points) if (typeof p.memberCount === 'number') countByTs.set(p.ts, p.memberCount);
    }
    const countSeries = [...countByTs.entries()].sort((a, b) => a[0].localeCompare(b[0])).map((e) => e[1]);
    const sizeLT = lastTwo(countSeries);
    const sizeDelta = deltaFor(sizeLT.prev, sizeLT.last, false);
    if (sizeDelta) out.set('size', sizeDelta);

    for (const spec of preset?.headlineKpis ?? []) {
      if (spec.id === 'size') continue;
      const series = byMeasure.get(spec.measure);
      if (!series || series.points.length === 0) continue;
      const lt = lastTwo(series.points.map((p) => p.value));
      const d = deltaFor(lt.prev, lt.last, spec.format === 'percent');
      if (d) out.set(spec.id, d);
    }
    return out;
  }, [data, preset]);
}
