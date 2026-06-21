/**
 * KPI trend section — canonical segment KPIs over time, one line per metric.
 *
 * A metric-selector chip row sits above the chart: plotting all 10 metrics on a
 * single Y axis flattens the small ones (LTV total ≈ ₫135B dwarfs rates/counts
 * onto zero), so the chart defaults to a small legible set and the user toggles
 * the rest. The selector is local view state — it doesn't refetch (the read
 * already returns every series).
 */

import { ReactElement, useMemo, useState } from 'react';
import { segmentMovementClient, type MovementGranularity, type KpiTrendSeries } from '../../../../../api/segment-movement-client';
import { useMovementResource } from './use-movement-resource';
import { buildKpiTrendChart, shortMetricLabel } from './build-movement-chart';
import { MovementSection } from './movement-section';
import styles from '../../../segments.module.css';

interface Props {
  segmentId: string;
  granularity: MovementGranularity;
  days: number;
  /** Explicit window from the tab range picker; overrides `days` when set. */
  from?: string;
  to?: string;
}

/** Labels worth defaulting on — legible together (counts + the headline total). */
const DEFAULT_KEYWORDS = ['user count', 'paying users', 'ltv total', 'size', 'member'];

/** Pick the default-visible metric set: keyword matches (capped), else first 3. */
function defaultSelection(series: KpiTrendSeries[]): Set<string> {
  const matched = series
    .filter((s) => DEFAULT_KEYWORDS.some((k) => shortMetricLabel(s.metricId).toLowerCase().includes(k)))
    .slice(0, 4)
    .map((s) => s.metricId);
  const ids = matched.length > 0 ? matched : series.slice(0, 3).map((s) => s.metricId);
  return new Set(ids);
}

export function KpiTrendSection({ segmentId, granularity, days, from, to }: Props): ReactElement {
  const { data, loading, error } = useMovementResource(
    () => segmentMovementClient.kpiTrend(segmentId, { granularity, days, from, to }),
    [segmentId, granularity, days, from, to],
  );

  const series = data?.series ?? [];
  // null until the user touches a chip; falls back to the (reactive) default so
  // a range/grain change that changes the available metrics re-derives sanely.
  const [touched, setTouched] = useState<Set<string> | null>(null);
  const fallback = useMemo(() => defaultSelection(series), [series]);
  const selected = touched ?? fallback;

  function toggle(id: string): void {
    const next = new Set(touched ?? fallback);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTouched(next);
  }

  const shown = series.filter((s) => selected.has(s.metricId));
  const artifact = data ? buildKpiTrendChart(segmentId, 'KPI trends', shown) : null;

  const control = series.length > 0 ? (
    <div className={styles.metricSelectorBar} role="group" aria-label="KPI lines">
      <span className={styles.metricSelectorLabel}>Lines</span>
      {series.map((s) => {
        const on = selected.has(s.metricId);
        return (
          <button
            key={s.metricId}
            type="button"
            aria-pressed={on}
            className={[styles.metricChip, on ? styles.metricChipOn : ''].filter(Boolean).join(' ')}
            onClick={() => toggle(s.metricId)}
          >
            {shortMetricLabel(s.metricId)}
          </button>
        );
      })}
    </div>
  ) : undefined;

  return (
    <MovementSection
      title="KPI trends"
      loading={loading}
      error={error}
      artifact={artifact}
      control={control}
      emptyHint={
        series.length > 0 && shown.length === 0
          ? 'No lines selected — pick a metric above to plot.'
          : 'No KPI snapshots captured in this range yet.'
      }
    />
  );
}
