/**
 * LiveopsPage — /liveops (Command Center).
 *
 * The LiveOps monitoring center's landing: open high-severity anomalies, the five
 * hero KPIs, and the absorbed Ops overview trends (monetization + support +
 * acquisition). Sibling surfaces — Diagnostics, Monetization, Retention, Alerts —
 * live under /liveops/* and are reached from the sidebar.
 *
 * Typography and spacing follow the shared cube-playground design tokens (Inter
 * via var(--font-sans), --text-* + --border-* + --radius-*) so this surface reads
 * like the rest of the app (Dashboards, Cohort, Segments).
 */

import { type CSSProperties } from 'react';
import { Radio } from 'lucide-react';
import { useGameContext } from '../../components/Header/use-game-context';
import { KpiHeroStrip } from './kpi-hero-strip';
import { AnomalyHighSeverityStrip } from './anomaly-high-severity-strip';
import { OpsOverviewSection } from './command-center/ops-overview-section';

const pageStyle: CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1200,
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
  margin: '4px 0 20px',
  fontSize: 13,
  color: 'var(--text-muted)',
  maxWidth: '60ch',
};

export function LiveopsPage() {
  const { gameId } = useGameContext();

  return (
    <div style={pageStyle}>
      <div style={eyebrowStyle}>Live operations · {gameId}</div>
      <div style={headStyle}>
        <Radio size={20} style={{ color: 'var(--brand)' }} />
        <h1 style={titleStyle}>Command Center</h1>
      </div>
      <p style={subheadStyle}>
        The daily standup for {gameId}: open anomalies, the five hero metrics, and the monetization
        &amp; support trends — refreshed on the cache cadence.
      </p>

      <AnomalyHighSeverityStrip gameId={gameId} />
      <KpiHeroStrip gameId={gameId} />

      {/* Portfolio row (cross-title, "All games" mode) lands in a later build step. */}

      <OpsOverviewSection gameId={gameId} />
    </div>
  );
}
