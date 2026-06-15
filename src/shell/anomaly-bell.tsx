/**
 * AnomalyBell — topbar icon showing count of open med+ anomalies.
 * Clicking navigates to /liveops/anomalies.
 * Hidden count badge when zero.
 */

import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useActiveGameId } from '../components/Header/use-game-context';
import { useAnomalies } from '../pages/Liveops/anomaly-inbox/use-anomalies';

export function AnomalyBell() {
  const gameId = useActiveGameId();
  const { anomalies } = useAnomalies(gameId);

  // Only surface med+ severity in the count
  const count = anomalies.filter(
    (a) => a.severity === 'med' || a.severity === 'high',
  ).length;

  return (
    <Link
      to="/liveops/anomalies"
      title={count > 0 ? `${count} open anomaly${count !== 1 ? 's' : ''}` : 'Anomaly inbox'}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        borderRadius: 8,
        color: count > 0 ? 'var(--danger)' : 'var(--text-muted)',
        textDecoration: 'none',
      }}
    >
      <Bell size={18} />

      {count > 0 && (
        <span style={{
          position: 'absolute',
          top: 2,
          right: 2,
          minWidth: 16,
          height: 16,
          borderRadius: 8,
          background: 'var(--danger)',
          color: 'var(--text-on-brand)',
          fontSize: 10,
          fontWeight: 700,
          lineHeight: '16px',
          textAlign: 'center',
          padding: '0 3px',
        }}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
