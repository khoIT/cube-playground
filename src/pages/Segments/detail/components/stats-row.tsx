/**
 * Compact inline stats row — replaces the 4-cell KPI strip on segment detail.
 *
 * Renders headline metrics as a single horizontal row (label / value / optional
 * delta) separated by vertical dividers. No card chrome — sits flush with the
 * detail header to conserve vertical space while keeping the same numbers
 * scannable.
 */

import { ReactElement, ReactNode, useMemo } from 'react';
import type { Query } from '@cubejs-client/core';
import { useSegmentCubeQuery } from '../use-segment-cube-query';
import { formatValue } from '../cards/format-value';
import { getCachedRows, isCacheFresh } from '../cards/use-card-cache-lookup';
import type { KpiSpec, Preset } from '../../presets/types';
import type { Segment } from '../../../../types/segment-api';
import styles from './stats-row.module.css';

type Tone = 'neutral' | 'positive' | 'negative';

export interface StatItem {
  id: string;
  label: string;
  value: ReactNode;
  delta?: string;
  tone?: Tone;
  footer?: ReactNode;
  /** Leading glyph rendered in a muted chip to the left of the metric. */
  icon?: ReactNode;
}

interface StatsRowProps {
  items: StatItem[];
}

/**
 * Shared cell body: a muted icon chip on the left, with label / value+delta /
 * footer stacked on the right. Used by both the data-bound preset cells and
 * the synthesized fallback cells so the layout never drifts between them.
 */
export function StatCellInner({
  icon, label, value, delta, tone, footer,
}: {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  tone?: Tone;
  footer?: ReactNode;
}): ReactElement {
  return (
    <>
      {icon != null && <span className={styles.kpiIcon} aria-hidden>{icon}</span>}
      <div className={styles.statCellBody}>
        <div className={styles.label}>{label}</div>
        <div className={styles.valueRow}>
          <span className={styles.value}>{value}</span>
          {delta != null && (
            <span className={styles.delta} data-tone={tone ?? 'neutral'}>{delta}</span>
          )}
        </div>
        {footer != null && <div className={styles.footer}>{footer}</div>}
      </div>
    </>
  );
}

/** Pure render — caller resolves values. */
export function StatsRow({ items }: StatsRowProps): ReactElement {
  return (
    <div className={styles.statsRow} role="group" aria-label="Segment headline metrics">
      {items.map((item, idx) => (
        <div key={item.id} className={styles.statCell} data-divider={idx > 0 ? 'true' : 'false'}>
          <StatCellInner
            icon={item.icon}
            label={item.label}
            value={item.value}
            delta={item.delta}
            tone={item.tone}
            footer={item.footer}
          />
        </div>
      ))}
    </div>
  );
}

/** Data-bound cell that resolves a preset KpiSpec into a StatItem entry. */
export function useStatItemFromKpi(
  spec: KpiSpec,
  segment: Segment,
  preset: Preset,
  cacheKey?: string,
  comparison?: { text: string; tone: Tone } | null,
): StatItem {
  const query = useMemo<Query>(() => ({
    measures: [spec.measure],
    ...(spec.timeDimension && spec.dateRange
      ? { timeDimensions: [{ dimension: spec.timeDimension, dateRange: spec.dateRange }] }
      : {}),
  }), [spec]);

  const initialRows = cacheKey ? getCachedRows(segment, cacheKey) : undefined;
  const skipBackgroundFetch = cacheKey ? isCacheFresh(segment, cacheKey) : false;
  const { rows, loading, error } = useSegmentCubeQuery(segment, query, preset.identityDim, {
    initialRows,
    skipBackgroundFetch,
  });

  const value = loading ? '…' : error ? '—' : formatValue(rows[0]?.[spec.measure] ?? null, spec.format);

  return {
    id: spec.id,
    label: spec.label,
    value,
    delta: comparison?.text,
    tone: comparison?.tone ?? 'neutral',
    footer: spec.unit ?? null,
  };
}
