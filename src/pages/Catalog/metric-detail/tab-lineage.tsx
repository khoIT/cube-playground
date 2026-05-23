import { useMemo } from 'react';

import type { BusinessMetric } from '../metrics-tab/business-metric-types';
import { LineageColumns } from './lineage-columns';
import { buildLineage } from './lineage-graph-builder';

interface TabLineageProps {
  metric: BusinessMetric;
  allMetrics: BusinessMetric[];
}

export function TabLineage({ metric, allMetrics }: TabLineageProps) {
  const lineage = useMemo(
    () => buildLineage(metric, allMetrics),
    [metric, allMetrics],
  );
  return <LineageColumns lineage={lineage} metricLabel={metric.label} />;
}
