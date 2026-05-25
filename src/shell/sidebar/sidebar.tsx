/**
 * Sidebar — 260px (expanded) / 60px (icon rail) fixed left navigation.
 * Collapsed state persists in localStorage and is read synchronously on mount
 * so there's no width flash. IA: Chat / Playground / Data Model / Metrics
 * Catalog / Segments / Advanced.
 */
import React from 'react';
import { useLocation } from 'react-router-dom';
import { MessageSquare, LayoutDashboard, BarChart3, Users, Grid, Radio, LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { T } from '../theme';
import { SidebarSection } from './sidebar-section';
import { SidebarItem } from './sidebar-item';
import { RecentItems } from './recent-items';
import { SidebarChatRecents } from './sidebar-chat-recents';
import { WorkspacePill } from './workspace-pill';
import { BottomRow } from './bottom-row';
import { CollapseToggle } from './collapse-toggle';
import { getCollapsed, onCollapsedChange } from './sidebar-collapsed-store';
import { getSidebarSectionForPath, setSectionExpanded } from './sidebar-section-store';
import { useVisibleNavItems } from '../../pages/Settings/use-visible-nav-items';
import { useBusinessMetrics } from '../../pages/Catalog/metrics-tab/use-business-metrics';
import { useConcepts } from '../../pages/Catalog/data-model-tab/use-concepts';
import { useSegmentIds } from '../../pages/Segments/use-segment-ids';

const SIDEBAR_WIDTH_EXPANDED = 260;
const SIDEBAR_WIDTH_COLLAPSED = 60;

export function Sidebar() {
  const { t } = useTranslation();
  const [collapsed, setCollapsedState] = React.useState<boolean>(() => getCollapsed());
  const { isVisible } = useVisibleNavItems();

  // Pull the live registries so recents that point at deleted artifacts are
  // hidden from the tray. While loading we leave the filter pass-through to
  // avoid flashing items out and back in on first paint.
  const { metrics, loading: metricsLoading } = useBusinessMetrics();
  const { concepts, loading: conceptsLoading } = useConcepts();
  const { ids: segmentIds } = useSegmentIds();
  const metricIds = React.useMemo(
    () => (metricsLoading ? null : new Set(metrics.map((m) => m.id))),
    [metrics, metricsLoading],
  );
  const conceptFqns = React.useMemo(
    () => (conceptsLoading ? null : new Set(concepts.map((c) => c.fqn))),
    [concepts, conceptsLoading],
  );

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
        {isVisible('chats') && (
          <SidebarSection
            id="chats"
            icon={MessageSquare}
            label={t('nav.chat')}
            to="/chat"
            collapsed={collapsed}
          >
            <SidebarChatRecents />
          </SidebarSection>
        )}

        {isVisible('playground') && (
          <SidebarSection
            id="playground"
            icon={LayoutDashboard}
            label={t('nav.playground')}
            to="/build"
            collapsed={collapsed}
          >
            <RecentItems
              module="playground"
              seeAllTo="/build"
              emptyLabel="No recent queries"
            />
          </SidebarSection>
        )}

        {isVisible('data-model') && (
          <SidebarSection
            id="data-model"
            icon={Grid}
            label={t('nav.dataModel')}
            to="/catalog/data-model"
            // Concept detail pages live under /catalog/concept/:type/:fqn —
            // include them so the parent stays highlighted from a child click.
            matchPrefix={['/catalog/data-model', '/catalog/concept']}
            collapsed={collapsed}
          >
            <RecentItems
              module="data-model"
              seeAllTo="/catalog/data-model"
              hrefFor={(id) => `/catalog/data-model/${id}`}
              // Drop legacy entries written before concept-only filtering — the
              // sub-tab routes `/catalog/data-model/cubes` and `…/models` used to
              // get pushed as literal id strings. Also hide ids no longer present
              // in /meta (concept removed from yaml).
              filter={(item) =>
                item.id !== 'cubes' &&
                item.id !== 'models' &&
                (conceptFqns === null || conceptFqns.has(item.id))
              }
            />
          </SidebarSection>
        )}

        {isVisible('metrics-catalog') && (
          <SidebarSection
            id="metrics-catalog"
            icon={BarChart3}
            label={t('nav.metricsCatalog')}
            to="/catalog/metrics"
            // Metric detail pages live at /catalog/metric/:id (singular) —
            // include them so the parent stays highlighted from a child click.
            matchPrefix={['/catalog/metrics', '/catalog/metric']}
            collapsed={collapsed}
          >
            <RecentItems
              module="metrics-catalog"
              seeAllTo="/catalog/metrics"
              // Hide ids no longer in the business-metrics registry (metric
              // removed/renamed in yaml or via API).
              filter={(item) => metricIds === null || metricIds.has(item.id)}
            />
          </SidebarSection>
        )}

        {isVisible('liveops') && (
          <SidebarSection
            id="liveops"
            icon={Radio}
            label={t('nav.liveops')}
            to="/liveops"
            flat
            collapsed={collapsed}
          />
        )}

        {isVisible('dashboards') && (
          <SidebarSection
            id="dashboards"
            icon={LayoutGrid}
            label={t('nav.dashboards')}
            to="/dashboards"
            flat
            collapsed={collapsed}
          />
        )}

        {isVisible('segments') && (
          <SidebarSection
            id="segments"
            icon={Users}
            label={t('nav.segments')}
            to="/segments"
            collapsed={collapsed}
          >
            <RecentItems
              module="segments"
              seeAllTo="/segments"
              // Drop legacy entries that recorded the segment UUID as both id
              // and title (written before the detail page pushed the real
              // name) AND any id no longer present in the server's segments
              // list (deleted in another tab, by another user, or directly
              // via API).
              filter={(item) =>
                item.title !== item.id &&
                (segmentIds === null || segmentIds.has(item.id))
              }
            />
          </SidebarSection>
        )}
      </nav>

      <BottomRow collapsed={collapsed} />
      <CollapseToggle collapsed={collapsed} />
    </aside>
  );
}
