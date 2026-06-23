/**
 * LiveopsPage — /liveops (Command Center).
 *
 * The LiveOps monitoring center's landing: open high-severity anomalies, the five
 * hero KPIs, and the absorbed Ops overview trends (monetization + support +
 * acquisition). Sibling surfaces — Diagnostics, Monetization, Retention, Alerts —
 * live under /liveops/* and are reached from the sidebar.
 *
 * "This game | All games" toggle (local state, never touches the global selector):
 *   - "This game" (default) → single-game view: anomaly strip + KPI strip + ops trends.
 *   - "All games" → PortfolioGrid replacing the single-game section; row click drills
 *     back into the active game and flips the toggle to "This game".
 *
 * Typography and spacing follow the shared cube-playground design tokens (Inter
 * via var(--font-sans), --text-* + --border-* + --radius-*) so this surface reads
 * like the rest of the app (Dashboards, Cohort, Segments).
 */

import { useState, type CSSProperties } from 'react';
import { Radio } from 'lucide-react';
import { useGameContext } from '../../components/Header/use-game-context';
import { KpiHeroStrip } from './kpi-hero-strip';
import { AnomalyHighSeverityStrip } from './anomaly-high-severity-strip';
import { OpsOverviewSection } from './command-center/ops-overview-section';
import { PortfolioGrid } from './command-center/portfolio-grid';

// ── Styles ────────────────────────────────────────────────────────────────────

const pageStyle: CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1400,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};

const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginBottom: 4,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--text-primary)',
  letterSpacing: '-0.005em',
};

const eyebrowStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 6,
};

const subheadStyle: CSSProperties = {
  margin: '4px 0 16px',
  fontSize: 13,
  color: 'var(--text-muted)',
  maxWidth: '60ch',
};

// ── Toggle ────────────────────────────────────────────────────────────────────

type ViewMode = 'single' | 'portfolio';

function ViewToggle({
  mode,
  onChange,
  multiGame,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
  multiGame: boolean;
}) {
  if (!multiGame) return null;

  const btnBase: CSSProperties = {
    padding: '4px 14px',
    fontSize: 12,
    fontWeight: 600,
    border: '1px solid var(--border-card)',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    transition: 'background 0.1s, color 0.1s',
  };
  const activeStyle: CSSProperties = {
    ...btnBase,
    background: 'var(--brand)',
    color: 'var(--text-on-brand, var(--bg-card))',
    borderColor: 'var(--brand)',
  };
  const inactiveStyle: CSSProperties = {
    ...btnBase,
    background: 'var(--bg-card)',
    color: 'var(--text-muted)',
  };

  return (
    <div
      style={{
        display: 'flex',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        border: '1px solid var(--border-card)',
        width: 'fit-content',
        marginBottom: 16,
      }}
    >
      <button
        style={{
          ...(mode === 'single' ? activeStyle : inactiveStyle),
          borderRadius: 0,
          border: 'none',
          borderRight: '1px solid var(--border-card)',
        }}
        onClick={() => onChange('single')}
      >
        This game
      </button>
      <button
        style={{
          ...(mode === 'portfolio' ? activeStyle : inactiveStyle),
          borderRadius: 0,
          border: 'none',
        }}
        onClick={() => onChange('portfolio')}
      >
        All games
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function LiveopsPage() {
  const { gameId, games, setGameId } = useGameContext();
  const [mode, setMode] = useState<ViewMode>('single');

  // Only show the toggle when the user has access to more than one game.
  const multiGame = games.length > 1;

  function handleDrillIn(id: string) {
    setGameId(id);
    setMode('single');
  }

  const eyebrow =
    mode === 'portfolio'
      ? 'Live operations · all games'
      : `Live operations · ${gameId}`;

  const subhead =
    mode === 'portfolio'
      ? 'Cross-title overview — ranked by revenue, WoW trend, health flags. Click a row to drill into single-game Command Center.'
      : `The daily standup for ${gameId}: open anomalies, the five hero metrics, and the monetization & support trends — refreshed on the cache cadence.`;

  return (
    <div style={pageStyle}>
      <div style={eyebrowStyle}>{eyebrow}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 4 }}>
        <div style={headStyle}>
          <Radio size={20} style={{ color: 'var(--brand)' }} />
          <h1 style={titleStyle}>Command Center</h1>
        </div>
        <ViewToggle mode={mode} onChange={setMode} multiGame={multiGame} />
      </div>
      <p style={subheadStyle}>{subhead}</p>

      {mode === 'portfolio' ? (
        <PortfolioGrid games={games} onDrillIn={handleDrillIn} />
      ) : (
        <>
          <AnomalyHighSeverityStrip gameId={gameId} />
          <KpiHeroStrip gameId={gameId} />
          <OpsOverviewSection gameId={gameId} />
        </>
      )}
    </div>
  );
}
