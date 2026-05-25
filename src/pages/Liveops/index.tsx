/**
 * LiveopsPage — /liveops route.
 *
 * Renders the Live KPI hero strip for the active game at the top.
 * Phase 2 additions: AnomalyHighSeverityStrip above the hero strip.
 */

import { useGameContext } from '../../components/Header/use-game-context';
import { KpiHeroStrip } from './kpi-hero-strip';
import { AnomalyHighSeverityStrip } from './anomaly-high-severity-strip';

export function LiveopsPage() {
  const { gameId } = useGameContext();

  return (
    <div style={{ padding: '0 0 32px' }}>
      {/* Surface 4: high-severity strip above KPI hero */}
      <AnomalyHighSeverityStrip gameId={gameId} />

      <KpiHeroStrip gameId={gameId} />

      {/* Placeholder body — phase 3 will insert dashboards here */}
      <div style={{
        margin: '24px 20px 0',
        padding: 24,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-lg)',
        color: 'var(--text-muted)',
        fontSize: 13,
        textAlign: 'center',
      }}>
        More liveops panels coming in future phases.
      </div>
    </div>
  );
}
