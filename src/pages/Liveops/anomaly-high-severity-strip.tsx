/**
 * AnomalyHighSeverityStrip — 1-line banner above KPI hero strip.
 * Shown only when ≥1 open high-severity anomaly exists for the active game.
 * Clicking navigates to /liveops/anomalies?severity=high.
 */

import { useHistory } from 'react-router-dom';
import { useAnomalies } from './anomaly-inbox/use-anomalies';

interface Props {
  gameId: string;
}

export function AnomalyHighSeverityStrip({ gameId }: Props) {
  const history = useHistory();
  const { anomalies } = useAnomalies(gameId);

  const highCount = anomalies.filter((a) => a.severity === 'high').length;
  if (highCount === 0) return null;

  return (
    <button
      onClick={() => history.push('/liveops/anomalies?severity=high')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: '12px 20px 0',
        // calc subtracts the 20px left+right outer padding of the parent
        width: 'calc(100% - 40px)',
        padding: '8px 14px',
        background: '#fee2e2',
        border: '1px solid #fca5a5',
        borderRadius: 8,
        cursor: 'pointer',
        textAlign: 'left',
        fontSize: 13,
        fontWeight: 600,
        color: '#dc2626',
        lineHeight: 1.4,
      }}
      aria-live="polite"
    >
      🔴 {highCount} high-severity{' '}
      {highCount === 1 ? 'anomaly' : 'anomalies'} — review
    </button>
  );
}
