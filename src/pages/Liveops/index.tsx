/**
 * LiveopsPage — /liveops route.
 *
 * Page header + KPI hero strip + anomaly entry-point + sub-page nav.
 * Typography and spacing follow the shared cube-playground design tokens
 * (Inter via var(--font-sans), --text-* + --border-* + --radius-*) so this
 * surface reads like the rest of the app (Dashboards, Cohort, Segments).
 */

import { type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight } from 'lucide-react';
import { useGameContext } from '../../components/Header/use-game-context';
import { KpiHeroStrip } from './kpi-hero-strip';
import { AnomalyHighSeverityStrip } from './anomaly-high-severity-strip';

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

const navRowStyle: CSSProperties = {
  marginTop: 28,
  paddingTop: 18,
  borderTop: '1px solid var(--border-card)',
  display: 'flex',
  gap: 18,
  flexWrap: 'wrap',
};

const navLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--text-secondary)',
  textDecoration: 'none',
};

export function LiveopsPage() {
  const { gameId } = useGameContext();

  return (
    <div style={pageStyle}>
      <div style={eyebrowStyle}>Live operations · {gameId}</div>
      <div style={headStyle}>
        <Activity size={20} style={{ color: 'var(--brand)' }} />
        <h1 style={titleStyle}>Daily standup</h1>
      </div>
      <p style={subheadStyle}>
        Five hero metrics for {gameId}, refreshed on the cache cadence.
        Open anomalies surface inline above the strip.
      </p>

      <AnomalyHighSeverityStrip gameId={gameId} />
      <KpiHeroStrip gameId={gameId} />

      <div style={navRowStyle}>
        <Link to="/liveops/cohort" style={navLinkStyle}>
          Cohort retention <ArrowRight size={14} />
        </Link>
        <Link to="/liveops/anomalies" style={navLinkStyle}>
          Anomaly archive <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
