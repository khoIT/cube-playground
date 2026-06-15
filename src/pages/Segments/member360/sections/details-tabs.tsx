/**
 * Details section — tabbed sub-panels (Roles / Behavior / Combat / Devices /
 * IPs / Activity / Recharge / Care), mirroring the cfm-user360 reference. Only
 * the active tab's content mounts, so the event-stream (etl_*) tabs query Cube
 * lazily on selection. Tabs are derived from the per-game panel registry, so a
 * game without (e.g.) event panels simply shows fewer tabs.
 *
 * Care tab: always appended as the last tab when `showCareTab` is true.
 * It renders CareHistoryTab — cross-playbook timeline + recommended action +
 * treatment form (write-gated for viewer role). Does not depend on the panel
 * registry, so it never blocks panel-only games from showing the tab.
 */

import { ReactElement, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { panelsForGame, type Member360Panel } from '../member360-panels';
import { MemberPanel } from '../member-panel';
import type { CachedPanelSource } from '../use-cached-panel-source';
import { EventPanelGrid } from './event-panel-grid';
import { SectionCard } from './dashboard-stats';
import { CareHistoryTab } from '../care-history-tab';

interface TabDef {
  id: string;
  label: string;
  panelIds: string[];
  isEvent?: boolean;
  /** When true this tab renders the Care history panel, not a panel grid. */
  isCare?: boolean;
}

// Ordered tab groups. A tab appears only if ≥1 of its panels exists for the game.
const TAB_DEFS: TabDef[] = [
  { id: 'roles', label: 'Roles', panelIds: ['roles'] },
  { id: 'behavior', label: 'Behavior', isEvent: true, panelIds: ['login', 'logout', 'register', 'lottery', 'money_flow', 'tutorial', 'prop_flow', 'team_starts', 'newbie_detail'] },
  { id: 'combat', label: 'Combat', isEvent: true, panelIds: ['matches', 'game_detail'] },
  { id: 'devices', label: 'Devices', panelIds: ['devices'] },
  { id: 'ips', label: 'IPs', panelIds: ['ips'] },
  { id: 'activity', label: 'Activity', panelIds: ['activity_timeline', 'activity_monthly'] },
  { id: 'recharge', label: 'Recharge', panelIds: ['recharge_timeline', 'revenue_monthly', 'transactions'] },
  // Cross-cutting ops enrichment (cfm/jus only): identity net-new, billing
  // breakdown + lifetime reconciliation, and support tickets. These are
  // user_id-keyed snapshots / FE-bounded timelines (not dteventtime events), so
  // they render through the standard panel grid, not EventPanelGrid.
  { id: 'ops', label: 'Ops', panelIds: ['ops_identity', 'ops_billing_detail', 'ops_billing_lifetime', 'ops_cs_tickets'] },
];

// Care tab sentinel — rendered regardless of panel registry. Conditionally
// appended based on `showCareTab` prop.
const CARE_TAB: TabDef = { id: 'care', label: 'Care', panelIds: [], isCare: true };

interface Props {
  gameId: string | null;
  uid: string;
  /** Nightly precompute source — core panels render cache-first when present.
   *  Event (behavior) tabs always stay live by design. */
  cachedSource?: CachedPanelSource;
  /**
   * When true, appends a "Care" tab showing the VIP care history for the uid.
   * Pass true whenever the CS feature is enabled for the active game.
   * Defaults to false for backward compat.
   */
  showCareTab?: boolean;
}

export function DetailsTabs({ gameId, uid, cachedSource, showCareTab = false }: Props): ReactElement | null {
  const { t } = useTranslation();
  const byId = useMemo(() => {
    const m = new Map<string, Member360Panel>();
    for (const p of panelsForGame(gameId)) m.set(p.id, p);
    return m;
  }, [gameId]);

  const tabs = useMemo(() => {
    const panelTabs = TAB_DEFS
      .map((tab) => ({ ...tab, panels: tab.panelIds.map((id) => byId.get(id)).filter(Boolean) as Member360Panel[] }))
      .filter((tab) => tab.panels.length > 0);
    // Append Care tab last when the feature is active.
    return showCareTab ? [...panelTabs, { ...CARE_TAB, panels: [] }] : panelTabs;
  }, [byId, showCareTab]);

  // Deep-link: ?tab=<id> selects that tab on mount (e.g. care-queue "Open 360"
  // links to ?tab=care). Falls back to the first tab when absent / unmatched.
  const location = useLocation();
  const initialTab = useMemo(() => {
    const want = new URLSearchParams(location.search).get('tab');
    const idx = want ? tabs.findIndex((tab) => tab.id === want) : -1;
    return idx >= 0 ? idx : 0;
  }, [location.search, tabs]);

  const [active, setActive] = useState(initialTab);
  if (tabs.length === 0) return null;
  const current = tabs[Math.min(active, tabs.length - 1)];

  return (
    <SectionCard icon="📦" title={t('segments.member360.details', { defaultValue: 'Details' })}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
        {tabs.map((tab, i) => {
          const isActive = current.id === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(i)}
              style={{
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-md)',
                padding: '5px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                background: isActive ? 'var(--brand)' : 'var(--bg-muted)',
                color: isActive ? 'var(--text-on-brand)' : 'var(--text-secondary)',
              }}
            >
              {t(`segments.member360.tab.${tab.id}`, { defaultValue: tab.label })}
            </button>
          );
        })}
      </div>

      {current.isCare ? (
        <CareHistoryTab gameId={gameId} uid={uid} />
      ) : current.isEvent ? (
        <EventPanelGrid gameId={gameId} uid={uid} panels={current.panels} />
      ) : (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          {current.panels.map((p) => (
            <MemberPanel
              key={p.id}
              gameId={gameId}
              panel={p}
              idValues={[uid]}
              cached={cachedSource?.getCached(p.id) ?? null}
              cacheReady={cachedSource ? cachedSource.ready : true}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
