/**
 * State-distribution trend — how a categorical mf_users dimension's mix shifts
 * across the cohort over time (stacked bars). Dimension selector is allow-listed
 * to canonical state columns the server accepts; sensitive dims (payer tier)
 * are server-redacted for tokenless callers and render as an empty stack.
 */

import { ReactElement, useState } from 'react';
import { segmentMovementClient, type MovementGranularity } from '../../../../../api/segment-movement-client';
import { useMovementResource } from './use-movement-resource';
import { buildDistributionChart } from './build-movement-chart';
import { MovementSection } from './movement-section';
import styles from '../../../segments.module.css';

/** Allow-listed categorical dimensions (must be a subset of the server's
 *  canonical state-column allow-list). High-cardinality dims stay out. */
const DIMENSIONS: Array<{ key: string; label: string }> = [
  { key: 'lifecycle_stage', label: 'Lifecycle' },
  { key: 'payer_tier', label: 'Payer tier' },
  { key: 'churn_risk', label: 'Churn risk' },
  { key: 'country', label: 'Country' },
  { key: 'os_platform', label: 'OS' },
];

interface Props {
  segmentId: string;
  granularity: MovementGranularity;
  days: number;
}

export function StateDistributionTrendSection({ segmentId, granularity, days }: Props): ReactElement {
  const [dimension, setDimension] = useState<string>(DIMENSIONS[0].key);

  const { data, loading, error } = useMovementResource(
    () => segmentMovementClient.stateDistributionTrend(segmentId, dimension, { granularity, days }),
    [segmentId, dimension, granularity, days],
  );

  const artifact = data ? buildDistributionChart(segmentId, 'State distribution', data.rows) : null;

  const control = (
    <div className={styles.cadenceSegmented} role="radiogroup" aria-label="Distribution dimension">
      {DIMENSIONS.map((d) => {
        const selected = d.key === dimension;
        return (
          <button
            key={d.key}
            type="button"
            role="radio"
            aria-checked={selected}
            className={[styles.cadenceSegment, selected ? styles.cadenceSegmentActive : ''].filter(Boolean).join(' ')}
            onClick={() => !selected && setDimension(d.key)}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <MovementSection
      title="State distribution"
      loading={loading}
      error={error}
      artifact={artifact}
      asOf={data?.asOf ?? null}
      stale={data?.stale}
      cadenceChanges={data?.cadenceChanges}
      carryForward={data?.carryForward}
      control={control}
      emptyHint={
        data?.redacted
          ? 'This dimension is restricted — sign in to view its distribution.'
          : 'No distribution snapshots captured in this range yet.'
      }
    />
  );
}
