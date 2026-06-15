/**
 * CS Monitor Dashboard — /dashboards/cs
 *
 * Read-only portfolio view of the 21-playbook VIP Care program for the active game.
 * Layout: page header (eyebrow + icon + title) → portfolio strip (5 stats) →
 * 4-group collapsible playbook grid.
 *
 * Game switching (GamePicker in Topbar) automatically re-grades the grid via
 * useGameContext(). The availability resolver runs server-side on each fetch, so
 * cfm_vn ↔ jus_vn flips reflect the real per-game data readiness without any
 * client logic change.
 *
 * Design compliance:
 *   - Page padding: 24px 32px, maxWidth: 1320, margin: 0 auto.
 *   - Page header mirrors Dashboards/index.tsx and Liveops/cohort/index.tsx.
 *   - All colors via design tokens (var(--*)). No inline hex or raw pixel fonts.
 *   - Font: var(--font-sans). One font stack only.
 */

import React from 'react';
import { useHistory } from 'react-router-dom';
import { HeartHandshake, PlusCircle } from 'lucide-react';
import { useGameContext } from '../../../components/Header/use-game-context';
import { useAuthUser } from '../../../auth/auth-context';
import { useCarePlaybooks } from './use-care-playbooks';
import { useCareDataFreshness } from './use-care-data-freshness';
import { CareMonitorBody } from './care-monitor-body';

// ── Styles ────────────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1320,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};

// ── Page ──────────────────────────────────────────────────────────────────────

export function CsMonitorPage() {
  const { gameId } = useGameContext();
  const history = useHistory();
  const user = useAuthUser();
  const canWrite = user?.role === 'editor' || user?.role === 'admin';
  const care = useCarePlaybooks(gameId);
  const { status, counts } = care;
  const { asOfByCube } = useCareDataFreshness(gameId);

  const isLoading = status === 'idle' || status === 'loading';

  return (
    <div style={pageStyle}>
      {/* Page header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 4,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <HeartHandshake size={24} color="var(--brand)" />
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
            CS · VIP Care
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* + New playbook — editor/admin only */}
          {canWrite && (
            <button
              type="button"
              onClick={() => history.push('/dashboards/cs/playbooks/new')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 14px',
                background: 'var(--brand)',
                color: 'var(--text-on-brand)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              <PlusCircle size={14} />
              New playbook
            </button>
          )}

          {/* Live / total playbook count badge */}
          {!isLoading && status === 'success' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                background: 'var(--bg-muted)',
                padding: '5px 11px',
                borderRadius: 'var(--radius-full)',
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: counts.available > 0 ? 'var(--success)' : 'var(--border-strong)',
                  display: 'inline-block',
                }}
              />
              {gameId}
            </div>
          )}
        </div>
      </div>

      <CareMonitorBody
        gameId={gameId}
        care={care}
        asOfByCube={asOfByCube}
        canWrite={canWrite}
      />
    </div>
  );
}
