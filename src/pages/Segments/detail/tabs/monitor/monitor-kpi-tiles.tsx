/**
 * Monitor KPI tiles — the compact "movement view" summary row under the coverage
 * strip. One tile per headline KPI: its latest captured value plus the change
 * across the selected window (vs the window's first snapshot), so the cohort's
 * key metrics read at a glance the way the standalone Movement tab's tile row did.
 *
 * Values come from ONE kpi-trend read (all metrics) bounded to the tab range;
 * each tile is a series matched to the preset's headline KpiSpec by measure ref
 * (the writer stores metric_id = spec.measure). SIZE is synthetic — cohort
 * member_count rides every snapshot row, so it shows even without a count measure.
 * Counts/aggregates only; scoped to the slice (see the note beside the tiles).
 */

import { ReactElement, useMemo } from 'react';
import {
  segmentMovementClient,
  type KpiTrendSeries,
  type MovementGranularity,
} from '../../../../../api/segment-movement-client';
import type { Preset } from '../../../presets/types';
import type { Segment } from '../../../../../types/segment-api';
import { useMovementResource } from '../movement/use-movement-resource';
import { formatValue, formatCompact } from '../../cards/format-value';
import type { DateRange } from './monitor-range';
import styles from '../../../segments.module.css';

interface Props {
  segment: Segment;
  preset: Preset | null;
  range: DateRange;
  /** Active view grain — the delta compares the latest tick to the one grain-step
   *  before it ("vs prev hour" at 1h, "vs yesterday" at daily), so the tiles read
   *  as a movement view, not a window-start comparison. */
  granularity: MovementGranularity;
}

/** Last two non-null numbers in a ts-ascending point list (prev, last). */
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

/** What one grain-step back reads as in the delta footer. */
const PREV_LABEL: Record<MovementGranularity, string> = {
  daily: 'yesterday',
  '12h': 'prev 12h',
  '6h': 'prev 6h',
  '3h': 'prev 3h',
  '1h': 'prev hour',
  '30m': 'prev 30m',
  '15m': 'prev 15m',
};

interface Tile {
  id: string;
  label: string;
  value: string;
  /** Change vs the previous grain bucket, pre-formatted, with its tone. */
  delta: { text: string; tone: 'positive' | 'negative' | 'neutral' } | null;
  highlight: boolean;
}

function deltaFor(prev: number | null, last: number | null, isPercent: boolean): Tile['delta'] {
  if (prev === null || last === null) return null;
  const diff = last - prev;
  const tone = diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral';
  const sign = diff > 0 ? '▲' : diff < 0 ? '▼' : '→';
  if (isPercent) return { text: `${sign} ${Math.abs(diff * 100).toFixed(1)}pp`, tone };
  const pct = prev !== 0 ? (diff / Math.abs(prev)) * 100 : 0;
  return { text: `${sign} ${Math.abs(pct).toFixed(1)}%`, tone };
}

export function MonitorKpiTiles({ segment, preset, range, granularity }: Props): ReactElement | null {
  const { data, loading } = useMovementResource(
    () => segmentMovementClient.kpiTrend(segment.id, { granularity, from: range.from, to: range.to }),
    [segment.id, granularity, range.from, range.to],
  );
  const prevLabel = PREV_LABEL[granularity];

  // Derive tiles once per data/preset/grain change — the tab re-renders on every
  // control-bar state change, and this folds all series into maps each pass.
  const { tiles, sizeHasData } = useMemo(() => {
    const byMeasure = new Map<string, KpiTrendSeries>();
    for (const s of data?.series ?? []) byMeasure.set(s.metricId, s);

    // member_count rides every KPI row — fold all series' points into one ts→count.
    const countByTs = new Map<string, number>();
    for (const s of data?.series ?? []) {
      for (const p of s.points) if (typeof p.memberCount === 'number') countByTs.set(p.ts, p.memberCount);
    }
    const countSeries = [...countByTs.entries()].sort((a, b) => a[0].localeCompare(b[0])).map((e) => e[1]);
    const sizeLT = lastTwo(countSeries);

    const out: Tile[] = [];
    // SIZE leads, synthetic from member_count, highlighted like the reference.
    out.push({
      id: 'size',
      label: 'Size',
      value: sizeLT.last != null ? formatCompact(sizeLT.last) : formatCompact(segment.uid_count),
      delta: deltaFor(sizeLT.prev, sizeLT.last, false),
      highlight: true,
    });

    for (const spec of (preset?.headlineKpis ?? []).filter((k) => k.id !== 'size')) {
      const series = byMeasure.get(spec.measure);
      if (!series || series.points.length === 0) continue;
      const lt = lastTwo(series.points.map((p) => p.value));
      if (lt.last === null) continue;
      out.push({
        id: spec.id,
        label: spec.label,
        value: formatValue(lt.last, spec.format),
        delta: deltaFor(lt.prev, lt.last, spec.format === 'percent'),
        highlight: false,
      });
      if (out.length >= 6) break;
    }
    return { tiles: out, sizeHasData: sizeLT.last !== null };
  }, [data, preset, segment.uid_count]);

  if (!loading && tiles.length === 1 && !sizeHasData) return null;

  return (
    <div className={styles.kpiTileRow} role="group" aria-label="Segment KPI movement">
      {tiles.map((t) => (
        <div key={t.id} className={`${styles.kpiTile} ${t.highlight ? styles.kpiTileLead : ''}`}>
          <div className={styles.kpiTileLabel}>{t.label}</div>
          <div className={styles.kpiTileValue}>{t.value}</div>
          {t.delta ? (
            <div className={`${styles.kpiTileDelta} ${styles[`kpiTileDelta_${t.delta.tone}`]}`}>
              {t.delta.text} <span className={styles.kpiTileDeltaBase}>vs {prevLabel}</span>
            </div>
          ) : (
            <div className={styles.kpiTileDeltaBase}>no prior snapshot</div>
          )}
        </div>
      ))}
    </div>
  );
}
