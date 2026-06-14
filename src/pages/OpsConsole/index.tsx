/**
 * Ops Console — /ops
 *
 * A dedicated per-game 360 for payment + identity, built on the four ops data
 * layers (billing_detail / billing_lifetime / cs_ticket_detail / user_identity +
 * mf_users). Three tabs: Overview (window-aware aggregate), Members (uid search →
 * member360 link), Care (embedded VIP-care playbook monitor). cfm_vn / jus_vn only.
 *
 * Gate order matters: render Loading until the game context is `ready` — gameId
 * defaults to 'ballistar' and is corrected async, so we must never render the
 * console (or fire queries) on the default. Then restrict to the ops games.
 *
 * Inactive tabs UNMOUNT (not display:none) so the Care tab's 30s activity poll
 * stops when the user is on another tab.
 *
 * Design compliance: page-header pattern (24px 32px padding, centered maxWidth,
 * icon + 20px/700 title, uppercase eyebrow). Tokens only. Mirrors
 * src/pages/Dashboards/cs/index.tsx and src/pages/Liveops/cohort/index.tsx.
 */

import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { Gauge } from 'lucide-react';
import { CubeLoader } from '../../atoms';
import { useGameContext } from '../../components/Header/use-game-context';
import { isOpsGame } from './ops-games';
import { OpsConsoleTabs, isOpsTab, type OpsTab } from './ops-console-tabs';
import { OpsWindowToggle } from './ops-window-toggle';
import type { OpsWindow } from './ops-window';
import { OverviewTab } from './overview-tab';
import { MembersTab } from './members-tab';
import { CareTab } from './care-tab';

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1320,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};

function readTabParam(search: string): OpsTab | null {
  const tab = new URLSearchParams(search).get('tab');
  return isOpsTab(tab) ? tab : null;
}

export function OpsConsolePage() {
  const { gameId, games, ready } = useGameContext();
  const history = useHistory();
  const location = useLocation();

  const [activeTab, setActiveTab] = React.useState<OpsTab>(
    () => readTabParam(location.search) ?? 'overview',
  );
  const [window, setWindow] = React.useState<OpsWindow>('30d');

  // Keep the active tab in sync with a deep-linked ?tab= (back/forward, paste).
  React.useEffect(() => {
    const fromUrl = readTabParam(location.search);
    if (fromUrl && fromUrl !== activeTab) setActiveTab(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const onTabChange = React.useCallback(
    (next: OpsTab) => {
      setActiveTab(next);
      const params = new URLSearchParams(location.search);
      params.set('tab', next);
      history.replace({ search: params.toString() });
    },
    [history, location.search],
  );

  // Gate order: ready first (never act on the 'ballistar' default), then the game.
  if (!ready) return <CubeLoader />;

  if (!isOpsGame(gameId)) {
    const gameName = games.find((g) => g.id === gameId)?.name ?? gameId;
    return (
      <div style={pageStyle}>
        <div
          style={{
            padding: 32,
            textAlign: 'center',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-lg)',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}
        >
          Ops Console is not available for <strong>{gameName}</strong>. Switch to CrossFire Mobile VN
          or Justice VN to view the payment + identity 360.
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      {/* Page header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: 4,
            }}
          >
            Ops · Monetization + Identity
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <Gauge size={24} color="var(--brand)" />
            <h1
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)',
              }}
            >
              Ops Console
            </h1>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                background: 'var(--bg-muted)',
                padding: '4px 10px',
                borderRadius: 'var(--radius-full)',
              }}
            >
              {games.find((g) => g.id === gameId)?.name ?? gameId}
            </span>
          </div>
        </div>

        {/* Window toggle — only meaningful for the Overview tab */}
        {activeTab === 'overview' && <OpsWindowToggle value={window} onChange={setWindow} />}
      </div>

      <OpsConsoleTabs active={activeTab} onChange={onTabChange} />

      {/* Inactive tabs unmount (stops the Care 30s poll when away). */}
      {activeTab === 'overview' && <OverviewTab gameId={gameId} window={window} />}
      {activeTab === 'members' && <MembersTab gameId={gameId} />}
      {activeTab === 'care' && <CareTab gameId={gameId} />}
    </div>
  );
}
