/**
 * Sidebar — 260px (expanded) / 60px (icon rail) fixed left navigation.
 * Collapsed state persists in localStorage and is read synchronously on mount
 * so there's no width flash. IA: Chat / Playground / Data Model / Metrics
 * Catalog / Segments / Advanced.
 */
import React from 'react';
import { useLocation } from 'react-router-dom';
import { MessageSquare, LayoutDashboard, BookOpen, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { T } from '../theme';
import { SidebarSection } from './sidebar-section';
import { SidebarItem } from './sidebar-item';
import { RecentItems } from './recent-items';
import { WorkspacePill } from './workspace-pill';
import { BottomRow } from './bottom-row';
import { CollapseToggle } from './collapse-toggle';
import { SidebarDataModelSection } from './sidebar-data-model-section';
import { getCollapsed, onCollapsedChange } from './sidebar-collapsed-store';
import { getSidebarSectionForPath, setSectionExpanded } from './sidebar-section-store';

const SIDEBAR_WIDTH_EXPANDED = 260;
const SIDEBAR_WIDTH_COLLAPSED = 60;

export function Sidebar() {
  const { t } = useTranslation();
  const [collapsed, setCollapsedState] = React.useState<boolean>(() => getCollapsed());

  React.useEffect(() => onCollapsedChange(setCollapsedState), []);

  // Auto-expand the matching section when the route changes.
  const { pathname } = useLocation();
  React.useEffect(() => {
    const sectionId = getSidebarSectionForPath(pathname);
    if (sectionId) {
      setSectionExpanded(sectionId, true);
    }
  }, [pathname]);

  const width = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;

  return (
    <aside
      style={{
        width,
        flexShrink: 0,
        height: '100%',
        background: T.sidebar,
        borderRadius: 18,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: T.fSans,
        overflow: 'visible',
        position: 'relative',
        transition: 'width 0.16s ease',
        willChange: 'width',
      }}
    >
      <WorkspacePill collapsed={collapsed} />

      <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 0 12px' }}>
        <SidebarSection
          id="chats"
          icon={MessageSquare}
          label={t('nav.chat')}
          to="/chat"
          collapsed={collapsed}
        >
          <SidebarItem label="No recent items" to="/chat" indent muted />
        </SidebarSection>

        <SidebarSection
          id="playground"
          icon={LayoutDashboard}
          label={t('nav.playground')}
          to="/build"
          collapsed={collapsed}
          flat
        />

        <SidebarDataModelSection collapsed={collapsed} />

        <SidebarSection
          id="metrics-catalog"
          icon={BookOpen}
          label={t('nav.metricsCatalog')}
          to="/catalog/metrics"
          collapsed={collapsed}
        >
          <RecentItems module="metrics-catalog" seeAllTo="/catalog/metrics" />
        </SidebarSection>

        <SidebarSection
          id="segments"
          icon={Users}
          label={t('nav.segments')}
          to="/segments"
          collapsed={collapsed}
        >
          <RecentItems module="segments" seeAllTo="/segments" />
        </SidebarSection>
      </nav>

      <BottomRow collapsed={collapsed} />
      <CollapseToggle collapsed={collapsed} />
    </aside>
  );
}
