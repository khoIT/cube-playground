/**
 * useMergedAnomaly — single-source-of-truth resolver. Server-driven anomaly
 * state wins over YAML when present (detector takes over from author
 * curation). When the server has no entry, the YAML override remains.
 *
 * v1: server is sourced from /api/anomaly-state which itself currently
 * projects from YAML. The merge logic stays correct when a real detector
 * starts writing to the state file — author overrides become best-effort
 * historical demo data.
 */

import type {
  BusinessMetric,
  BusinessMetricAnomaly,
} from '../../pages/Catalog/metrics-tab/business-metric-types';
import { useAnomalyState } from './use-anomaly-state';

export function useMergedAnomaly(
  metric: BusinessMetric,
): BusinessMetricAnomaly | undefined {
  const { states } = useAnomalyState();
  const fromServer = states[metric.id];
  if (fromServer && fromServer.state !== 'none') return fromServer;
  return metric.anomaly;
}
