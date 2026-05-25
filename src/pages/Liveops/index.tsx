/**
 * LiveopsPage — /liveops route.
 *
 * Renders the Live KPI hero strip for the active game at the top.
 * The body below is a placeholder; phases 2/3 fill it with retention
 * funnels, crash timelines, etc.
 */

import { useGameContext } from '../../components/Header/use-game-context';
import { KpiHeroStrip } from './kpi-hero-strip';

export function LiveopsPage() {
  const { gameId } = useGameContext();

  return (
    <div style={{ padding: '0 0 32px' }}>
      <KpiHeroStrip gameId={gameId} />

      {/* Placeholder body — phases 2/3 will insert content here */}
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
