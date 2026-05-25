/**
 * LiveopsPage — /liveops route.
 *
 * Renders the Live KPI hero strip for the active game at the top.
 * Phase 2 additions: AnomalyHighSeverityStrip above the hero strip.
 */

import { Link } from 'react-router-dom';
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

      {/* Quick-nav links to Liveops sub-pages */}
      <div style={{ margin: '24px 20px 0', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Link
          to="/liveops/cohort"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text-secondary)',
            textDecoration: 'none',
          }}
        >
          Cohort retention grid
        </Link>
      </div>
    </div>
  );
}
