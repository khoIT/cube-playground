/** KPI trend section — canonical segment KPIs over time, one line per metric. */

import { ReactElement } from 'react';
import { segmentMovementClient, type MovementGranularity } from '../../../../../api/segment-movement-client';
import { useMovementResource } from './use-movement-resource';
import { buildKpiTrendChart } from './build-movement-chart';
import { MovementSection } from './movement-section';

interface Props {
  segmentId: string;
  granularity: MovementGranularity;
  days: number;
}

export function KpiTrendSection({ segmentId, granularity, days }: Props): ReactElement {
  const { data, loading, error } = useMovementResource(
    () => segmentMovementClient.kpiTrend(segmentId, { granularity, days }),
    [segmentId, granularity, days],
  );

  const artifact = data ? buildKpiTrendChart(segmentId, 'KPI trends', data.series) : null;

  return (
    <MovementSection
      title="KPI trends"
      loading={loading}
      error={error}
      artifact={artifact}
      asOf={data?.asOf ?? null}
      stale={data?.stale}
      cadenceChanges={data?.cadenceChanges}
      carryForward={data?.carryForward}
      emptyHint="No KPI snapshots captured in this range yet."
    />
  );
}
