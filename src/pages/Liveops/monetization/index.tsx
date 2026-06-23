/**
 * MonetizationPage — /liveops/monetization
 *
 * Monetization economics: payer-tier distribution, realized LTV-by-cohort,
 * revenue concentration, and SKU/pack performance. Header chrome only for now;
 * the cards land in a later build step. Page-header pattern mirrors Dashboards /
 * Cohort.
 */
import React from 'react';
import { CircleDollarSign } from 'lucide-react';
import { useGameContext } from '../../../components/Header/use-game-context';
import { HubSectionPlaceholder } from '../_hub/hub-section-placeholder';

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1200,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};

export function MonetizationPage() {
  const { gameId } = useGameContext();

  return (
    <div style={pageStyle}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: 6,
        }}
      >
        Live operations · {gameId}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <CircleDollarSign size={20} style={{ color: 'var(--brand)' }} />
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '-0.005em',
          }}
        >
          Monetization
        </h1>
      </div>

      <HubSectionPlaceholder
        icon={CircleDollarSign}
        title="Monetization deep-dive"
        note="Payer-tier distribution, realized LTV-by-cohort, revenue concentration, and SKU/pack performance. Arriving in a later build step."
      />
    </div>
  );
}
