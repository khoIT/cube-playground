/**
 * Command Center → Ops overview trends section.
 *
 * Absorbs the Ops Console Overview (cash / payers / gateway mix / ROAS / support /
 * concentration) into the LiveOps landing so the standup metrics + monetization
 * trends live in one place. Reuses OpsConsole/overview-tab.tsx unchanged — this
 * only owns the window selector + the game-availability gate (billing_detail is
 * onboarded for cfm_vn / jus_vn only; other games show a neutral note).
 */
import React from 'react';
import { isOpsGame } from '../../OpsConsole/ops-games';
import { OpsWindowToggle } from '../../OpsConsole/ops-window-toggle';
import type { OpsWindow } from '../../OpsConsole/ops-window';
import { OverviewTab } from '../../OpsConsole/overview-tab';

const headRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  marginBottom: 14,
};

const sectionTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-sans)',
};

export function OpsOverviewSection({ gameId }: { gameId: string }) {
  const [opsWindow, setOpsWindow] = React.useState<OpsWindow>('30d');

  return (
    <section style={{ marginTop: 28 }}>
      <div style={headRow}>
        <h2 style={sectionTitle}>Monetization &amp; ops trends</h2>
        {isOpsGame(gameId) && <OpsWindowToggle value={opsWindow} onChange={setOpsWindow} />}
      </div>

      {isOpsGame(gameId) ? (
        <OverviewTab gameId={gameId} window={opsWindow} />
      ) : (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-xl)',
            color: 'var(--text-muted)',
            fontSize: 12.5,
            fontFamily: 'var(--font-sans)',
          }}
        >
          Monetization &amp; ops trends are available for CrossFire Mobile VN and Justice VN (the
          payment + identity 360 is onboarded for those titles).
        </div>
      )}
    </section>
  );
}
