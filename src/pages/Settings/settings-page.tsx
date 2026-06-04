/**
 * Settings page shell. Two-column layout: vertical tab rail on the left,
 * active section on the right. Active tab persists in the URL hash so links
 * are shareable and the browser back button works.
 */

import { ReactElement, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHistory, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { ArrowLeft, PanelLeft, Gamepad2, Network, MessageCircle, Sparkles, Activity, LayoutGrid, ShieldCheck, Server, AlertTriangle, KeyRound } from 'lucide-react';

import { SettingsTabs, type SettingsTabDescriptor } from './settings-tabs';
import { NavVisibilitySection } from './nav-visibility-section';
import { GameVisibilitySection } from './game-visibility-section';
import { IdentityMapSection } from './identity-map-section';
import { ChatPreferencesSection } from './chat-preferences-section';
import { ChatServiceTab } from './ChatService/chat-service-tab';
import { LiveopsSettingsSection } from './liveops-settings-section';
import { DashboardsSettingsSection } from './dashboards-settings-section';
import { MetricCoverageSection } from './metric-coverage-section';
import { WorkspaceReadinessSection } from './workspace-readiness-section';
import { ApiSettingsSection } from './api-settings-section';
import { DriftCenterPage } from '../DriftCenter';
import { AdminAccessPage } from '../Admin/access';
import { useAuthUser } from '../../auth/auth-context';
import { useHasFeature } from '../../auth/feature-access';

const Page = styled.div`
  max-width: 1240px;
  margin: 32px auto;
  padding: 0 24px;
  font-family: var(--font-sans);
  color: var(--text-primary);
`;

const PageHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 24px;
`;

const BackButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;

  &:hover,
  &:focus-visible {
    color: var(--brand);
    border-color: var(--brand);
    background: var(--brand-soft);
  }
`;

const PageTitle = styled.h1`
  margin: 0;
  font-size: 22px;
  font-weight: 600;
`;

const Layout = styled.div`
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 24px;
  align-items: start;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

const Panel = styled.div`
  min-width: 0;
`;

type TabId = 'sidebar' | 'games' | 'identity' | 'chat' | 'chat-service' | 'liveops' | 'dashboards' | 'coverage' | 'workspace' | 'drift' | 'api' | 'access';

const DEFAULT_TAB: TabId = 'sidebar';

const KNOWN_TABS = new Set<string>([
  'sidebar', 'games', 'identity', 'chat', 'chat-service', 'liveops', 'dashboards', 'coverage', 'workspace', 'drift', 'api', 'access',
]);

function readHashTab(hash: string): TabId | null {
  const id = hash.replace(/^#/, '');
  return KNOWN_TABS.has(id) ? (id as TabId) : null;
}

export function SettingsPage(): ReactElement {
  const { t } = useTranslation();
  const history = useHistory();
  const location = useLocation();
  const user = useAuthUser();
  // Access management is admin-only (mirrors the server's necessary condition).
  const isAdmin = user?.role === 'admin';
  const hasFeature = useHasFeature();

  const [activeId, setActiveId] = useState<TabId>(
    () => readHashTab(location.hash) ?? DEFAULT_TAB,
  );

  // Keep state in sync when the user navigates via back/forward — react-router
  // updates `location.hash` but doesn't remount the page.
  useEffect(() => {
    const fromHash = readHashTab(location.hash);
    if (fromHash && fromHash !== activeId) setActiveId(fromHash);
  }, [location.hash, activeId]);

  const onTabChange = (id: string) => {
    const next = id as TabId;
    setActiveId(next);
    history.replace({ ...location, hash: `#${next}` });
  };

  const allTabs: SettingsTabDescriptor[] = useMemo(
    () => [
      {
        id: 'sidebar',
        label: t('settings.tabs.sidebar', { defaultValue: 'Sidebar' }),
        icon: PanelLeft,
      },
      {
        id: 'games',
        label: t('settings.tabs.games', { defaultValue: 'Games' }),
        icon: Gamepad2,
      },
      {
        id: 'identity',
        label: t('settings.tabs.identity', { defaultValue: 'Identity Map' }),
        icon: Network,
      },
      {
        id: 'chat',
        label: t('settings.tabs.chat', { defaultValue: 'Chat' }),
        icon: MessageCircle,
        feature: 'chats',
      },
      {
        id: 'chat-service',
        label: t('settings.tabs.chatService', { defaultValue: 'Chat Service' }),
        icon: Sparkles,
        feature: 'chats',
      },
      {
        id: 'liveops',
        label: t('settings.tabs.liveops', { defaultValue: 'Liveops' }),
        icon: Activity,
        feature: 'liveops',
      },
      {
        id: 'dashboards',
        label: t('settings.tabs.dashboards', { defaultValue: 'Dashboards' }),
        icon: LayoutGrid,
        feature: 'dashboards',
      },
      {
        id: 'coverage',
        label: t('settings.tabs.coverage', { defaultValue: 'Metric coverage' }),
        icon: ShieldCheck,
      },
      {
        id: 'drift',
        label: t('settings.tabs.drift', { defaultValue: 'Drift center' }),
        icon: AlertTriangle,
      },
      {
        id: 'workspace',
        label: t('settings.tabs.workspace', { defaultValue: 'Workspace' }),
        icon: Server,
      },
      {
        id: 'api',
        label: t('settings.tabs.api', { defaultValue: 'API' }),
        icon: KeyRound,
      },
      // Access management is admin-only — omit the tab entirely for non-admins.
      ...(isAdmin
        ? [
            {
              id: 'access',
              label: t('settings.tabs.access', { defaultValue: 'Access' }),
              icon: KeyRound,
            } as SettingsTabDescriptor,
          ]
        : []),
    ],
    [t, isAdmin],
  );

  // Drop tabs for features the user lacks (chat / liveops / dashboards). Tabs
  // without a `feature` are always shown. This is what removes a disabled
  // feature's settings surface, mirroring the sidebar gate.
  const tabs = useMemo(
    () => allTabs.filter((tab) => !tab.feature || hasFeature(tab.feature)),
    [allTabs, hasFeature],
  );

  const goBack = () => {
    if (history.length > 1) history.goBack();
    else history.push('/');
  };

  const renderActive = (): ReactElement => {
    // Guard direct-hash navigation to a feature-gated tab the user lacks (the
    // tab is already hidden from the rail) — fall back to the default section.
    const activeTab = allTabs.find((tab) => tab.id === activeId);
    if (activeTab?.feature && !hasFeature(activeTab.feature)) {
      return <NavVisibilitySection />;
    }
    switch (activeId) {
      case 'sidebar':
        return <NavVisibilitySection />;
      case 'games':
        return <GameVisibilitySection />;
      case 'identity':
        return <IdentityMapSection />;
      case 'chat':
        return <ChatPreferencesSection />;
      case 'chat-service':
        return <ChatServiceTab />;
      case 'liveops':
        return <LiveopsSettingsSection />;
      case 'dashboards':
        return <DashboardsSettingsSection />;
      case 'coverage':
        return <MetricCoverageSection />;
      case 'workspace':
        return <WorkspaceReadinessSection />;
      case 'drift':
        return <DriftCenterPage />;
      case 'api':
        return <ApiSettingsSection />;
      case 'access':
        // Guard direct hash navigation by non-admins (the tab itself is hidden).
        return isAdmin ? <AdminAccessPage /> : <NavVisibilitySection />;
    }
  };

  return (
    <Page>
      <PageHead>
        <BackButton
          type="button"
          onClick={goBack}
          aria-label={t('settings.back', { defaultValue: 'Back' })}
        >
          <ArrowLeft size={16} strokeWidth={2} aria-hidden />
        </BackButton>
        <PageTitle>{t('settings.title', { defaultValue: 'Settings' })}</PageTitle>
      </PageHead>

      <Layout>
        <SettingsTabs
          tabs={tabs}
          activeId={activeId}
          onChange={onTabChange}
          ariaLabel={t('settings.title', { defaultValue: 'Settings' })}
        />
        <Panel
          role="tabpanel"
          id={`settings-panel-${activeId}`}
          aria-labelledby={`settings-tab-${activeId}`}
        >
          {renderActive()}
        </Panel>
      </Layout>
    </Page>
  );
}

export default SettingsPage;
