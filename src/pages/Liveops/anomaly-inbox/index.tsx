/**
 * AnomalyInboxPage — /liveops/anomalies
 *
 * Triage inbox: severity-sorted open anomalies for the active game.
 * Accepts ?metric=<id> to pre-filter to a single metric.
 * Accepts ?severity=<level> to pre-filter by severity.
 */

import { useLocation } from 'react-router-dom';
import { useGameContext } from '../../../components/Header/use-game-context';
import { useAnomalies } from './use-anomalies';
import { AnomalyRow } from './anomaly-row';

function useQueryParam(search: string, key: string): string | null {
  return new URLSearchParams(search).get(key);
}

export function AnomalyInboxPage() {
  const { gameId } = useGameContext();
  const location = useLocation();
  const metricFilter   = useQueryParam(location.search, 'metric');
  const severityFilter = useQueryParam(location.search, 'severity');

  const { anomalies, loading, error, ack, snooze } = useAnomalies(gameId);

  const filtered = anomalies.filter((a) => {
    if (metricFilter   && a.metric   !== metricFilter)   return false;
    if (severityFilter && a.severity !== severityFilter) return false;
    return true;
  });

  return (
    <div style={{ padding: '24px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          Anomaly inbox
        </h2>
        {(metricFilter || severityFilter) && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {metricFilter ? `metric: ${metricFilter}` : ''}
            {metricFilter && severityFilter ? ' · ' : ''}
            {severityFilter ? `severity: ${severityFilter}` : ''}
          </span>
        )}
      </div>

      {/* States */}
      {loading && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
      )}

      {!loading && error && (
        <p style={{ color: 'var(--danger)', fontSize: 13 }}>
          Failed to load anomalies: {error}
        </p>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={{
          padding: 32, textAlign: 'center',
          background: 'var(--bg-card)', border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          color: 'var(--text-muted)', fontSize: 13,
        }}>
          No open anomalies for this game
          {metricFilter ? ` (metric: ${metricFilter})` : ''}
          {severityFilter ? ` (severity: ${severityFilter})` : ''}.
        </div>
      )}

      {/* Row list */}
      {filtered.length > 0 && (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}>
          {/* Column header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '80px 1fr auto auto 110px',
            gap: 12,
            padding: '8px 16px',
            borderBottom: '1px solid var(--border-card)',
            background: 'var(--surface-inset)',
          }}>
            {['Severity', 'Metric', 'Date', 'Game', 'Actions'].map((h) => (
              <span key={h} style={{
                fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.04em', color: 'var(--text-muted)',
              }}>
                {h}
              </span>
            ))}
          </div>

          {filtered.map((anomaly) => (
            <AnomalyRow
              key={anomaly.id}
              anomaly={anomaly}
              onAck={() => ack(anomaly.id)}
              onSnooze={(until) => snooze(anomaly.id, until)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
