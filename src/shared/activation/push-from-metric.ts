/**
 * push-from-metric — adapt a business metric into a payload the activation
 * surface (Segments / push-modal) understands.
 *
 * v1 routes via the Segments page using URL handoff. The push-modal upstream
 * (MM-01) needs a real segment, so we synthesise a segment-creation URL with
 * the metric context baked in. The Segments page then runs the push-modal
 * with the resolved segment id once the user clicks Create.
 */

import type { BusinessMetric } from '../../pages/Catalog/metrics-tab/business-metric-types';

export interface ActivationHandoff {
  url: string;
  inferredSegmentName: string;
}

export function pushFromMetric(metric: BusinessMetric): ActivationHandoff {
  const slug = `${metric.id}-activation`;
  const params = new URLSearchParams({
    'from-metric': metric.id,
    'segment-name': slug,
  });
  return {
    url: `/segments/new?${params.toString()}`,
    inferredSegmentName: slug,
  };
}
