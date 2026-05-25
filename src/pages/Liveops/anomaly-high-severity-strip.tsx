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
        marginBottom: 12,
        width: '100%',
        padding: '10px 14px',
        background: 'var(--destructive-soft)',
        border: '1px solid var(--destructive-soft)',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--destructive-ink)',
        lineHeight: 1.4,
      }}
      aria-live="polite"
    >
      <span aria-hidden style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: 'var(--danger)',
      }} />
      {highCount} high-severity{' '}
      {highCount === 1 ? 'anomaly' : 'anomalies'} — review
    </button>
  );
}
