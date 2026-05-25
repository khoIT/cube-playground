/**
 * LiveopsPage — /liveops route.
 *
 * Phase 1 (editorial direction): newspaper-style page header with a "deck"
 * label, a serif headline, and a tight subhead. Anomalies + KPIs are framed
 * by the same editorial grid (hairlines, generous whitespace).
 */

import { type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useGameContext } from '../../components/Header/use-game-context';
import { KpiHeroStrip } from './kpi-hero-strip';
import { AnomalyHighSeverityStrip } from './anomaly-high-severity-strip';

const deckStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-editorial-serif, Georgia, "Iowan Old Style", serif)',
};

const h1Style: CSSProperties = {
  margin: '4px 0 6px',
  fontFamily: 'var(--font-editorial-serif, Georgia, "Iowan Old Style", serif)',
  fontWeight: 600,
  fontSize: 34,
  letterSpacing: '-0.01em',
  color: 'var(--text-primary)',
};

const ledeStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  color: 'var(--text-muted)',
  maxWidth: '60ch',
};

const navLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 0',
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--text-secondary)',
  textDecoration: 'none',
  fontFamily: 'var(--font-editorial-serif, Georgia, "Iowan Old Style", serif)',
};

export function LiveopsPage() {
  const { gameId } = useGameContext();

  return (
    <div style={{ padding: '24px 24px 32px' }}>
      <header style={{ padding: '0 0 18px' }}>
        <div style={deckStyle}>Live operations · {gameId}</div>
        <h1 style={h1Style}>Daily standup, in detail.</h1>
        <p style={ledeStyle}>
          Five hero metrics with the gravitas of a print masthead. Anomalies
          file as stories — severity above all.
        </p>
      </header>

      <AnomalyHighSeverityStrip gameId={gameId} />

      <KpiHeroStrip gameId={gameId} />

      <div
        style={{
          margin: '24px 20px 0',
          display: 'flex',
          gap: 24,
          borderTop: '1px solid var(--rule-editorial, var(--border-card))',
        }}
      >
        <Link to="/liveops/cohort" style={navLinkStyle}>
          Cohort retention →
        </Link>
        <Link to="/liveops/anomalies" style={navLinkStyle}>
          Anomaly archive →
        </Link>
      </div>
    </div>
  );
}
