/**
 * AnomalyTileBadge — severity-coloured dot overlaid in the top-right corner
 * of a KPI tile. Clicking navigates to the inbox pre-filtered to that metric.
 */

import { useHistory } from 'react-router-dom';
import type { AnomalySeverity } from './anomaly-inbox/use-anomalies';

const SEVERITY_DOT: Record<AnomalySeverity, string> = {
  high: 'var(--danger)',
  med:  'var(--warning)',
  low:  'var(--info)',
};

interface AnomalyTileBadgeProps {
  severity: AnomalySeverity;
  metric: string;
}

export function AnomalyTileBadge({ severity, metric }: AnomalyTileBadgeProps) {
  const history = useHistory();

  return (
    <button
      title={`${severity.toUpperCase()} anomaly — click to review`}
      onClick={(e) => {
        e.stopPropagation();
        history.push(`/liveops/anomalies?metric=${encodeURIComponent(metric)}`);
      }}
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: SEVERITY_DOT[severity],
        border: '2px solid var(--bg-card)',
        padding: 0,
        cursor: 'pointer',
        boxShadow: `0 0 0 2px ${SEVERITY_DOT[severity]}40`,
      }}
      aria-label={`${severity} anomaly on ${metric}`}
    />
  );
}
