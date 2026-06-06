/**
 * Details section — tabbed sub-panels (Roles / Behavior / Combat / Devices /
 * IPs / Activity / Recharge), mirroring the cfm-user360 reference. Only the
 * active tab's content mounts, so the event-stream (etl_*) tabs query Cube
 * lazily on selection. Tabs are derived from the per-game panel registry, so a
 * game without (e.g.) event panels simply shows fewer tabs.
 */

import { ReactElement, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { panelsForGame, type Member360Panel } from '../member360-panels';
import { MemberPanel } from '../member-panel';
import type { CachedPanelSource } from '../use-cached-panel-source';
import { EventPanelGrid } from './event-panel-grid';
import { SectionCard } from './dashboard-stats';

interface TabDef {
  id: string;
  label: string;
  panelIds: string[];
  isEvent?: boolean;
}

// Ordered tab groups. A tab appears only if ≥1 of its panels exists for the game.
const TAB_DEFS: TabDef[] = [
  { id: 'roles', label: 'Roles', panelIds: ['roles'] },
  { id: 'behavior', label: 'Behavior', isEvent: true, panelIds: ['login', 'logout', 'lottery', 'money_flow', 'tutorial', 'prop_flow', 'team_starts', 'newbie_detail'] },
  { id: 'combat', label: 'Combat', isEvent: true, panelIds: ['matches', 'game_detail'] },
  { id: 'devices', label: 'Devices', panelIds: ['devices'] },
  { id: 'ips', label: 'IPs', panelIds: ['ips'] },
  { id: 'activity', label: 'Activity', panelIds: ['activity_timeline', 'activity_monthly'] },
  { id: 'recharge', label: 'Recharge', panelIds: ['recharge_timeline', 'revenue_monthly', 'transactions'] },
];

interface Props {
  gameId: string | null;
  uid: string;
  /** Nightly precompute source — core panels render cache-first when present.
   *  Event (behavior) tabs always stay live by design. */
  cachedSource?: CachedPanelSource;
}

export function DetailsTabs({ gameId, uid, cachedSource }: Props): ReactElement | null {
  const { t } = useTranslation();
  const byId = useMemo(() => {
    const m = new Map<string, Member360Panel>();
    for (const p of panelsForGame(gameId)) m.set(p.id, p);
    return m;
  }, [gameId]);

  const tabs = useMemo(
    () =>
      TAB_DEFS.map((tab) => ({ ...tab, panels: tab.panelIds.map((id) => byId.get(id)).filter(Boolean) as Member360Panel[] }))
        .filter((tab) => tab.panels.length > 0),
    [byId],
  );

  const [active, setActive] = useState(0);
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
                color: isActive ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {t(`segments.member360.tab.${tab.id}`, { defaultValue: tab.label })}
            </button>
          );
        })}
      </div>

      {current.isEvent ? (
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
