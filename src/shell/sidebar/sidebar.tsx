/**
 * Sidebar — 260px (expanded) / 60px (icon rail) fixed left navigation.
 * Collapsed state persists in localStorage and is read synchronously on mount
 * so there's no width flash. IA: Chat / Playground / Data Model / Metrics
 * Catalog / Segments / Advanced.
 */
import React from 'react';
import { useLocation } from 'react-router-dom';
import { MessageSquare, LayoutDashboard, BarChart3, Users, Grid, Radio, LayoutGrid, Heart, Gauge, Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { T } from '../theme';
import { SidebarSection } from './sidebar-section';
import { SidebarItem } from './sidebar-item';
import { RecentItems } from './recent-items';
import { SidebarChatRecents } from './sidebar-chat-recents';
import { WorkspacePill } from './workspace-pill';
import { BottomRow } from './bottom-row';
import { getCollapsed, onCollapsedChange } from './sidebar-collapsed-store';
import { getSidebarSectionForPath, setSectionExpanded } from './sidebar-section-store';
import { useVisibleNavItems } from '../../pages/Settings/use-visible-nav-items';
import { useHasFeature } from '../../auth/feature-access';
import { useBusinessMetrics } from '../../pages/Catalog/metrics-tab/use-business-metrics';
import { useConcepts } from '../../pages/Catalog/data-model-tab/use-concepts';
import {
  useSegmentRows,
  selectSharedSegments,
  filterRowsByGame,
} from '../../pages/Segments/use-segment-ids';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { isOpsGame } from '../../pages/OpsConsole/ops-games';
import { SharedPill } from './shared-pill';

const SIDEBAR_WIDTH_EXPANDED = 260;
const SIDEBAR_WIDTH_COLLAPSED = 60;

export function Sidebar() {
  const { t } = useTranslation();
  const [collapsed, setCollapsedState] = React.useState<boolean>(() => getCollapsed());
  const { isVisible } = useVisibleNavItems();
  const hasFeature = useHasFeature();
  // A section shows only when the user both has the feature granted (access)
  // AND hasn't hidden it via the sidebar preference (cosmetic). The nav ids
  // are 1:1 with feature keys, so the id doubles as the feature key.
  const showSection = (id: Parameters<typeof isVisible>[0]) => isVisible(id) && hasFeature(id);

  // Pull the live registries so recents that point at deleted artifacts are
  // hidden from the tray. While loading we leave the filter pass-through to
  // avoid flashing items out and back in on first paint.
  const { metrics, loading: metricsLoading } = useBusinessMetrics();
  const { concepts, loading: conceptsLoading } = useConcepts();
  // One fetch feeds both the recents-pruning id set and the shared-with-me
  // group below the recents (teammates' shared/org segments). Rows are
  // narrowed to the ACTIVE game before any selector runs: segments belong to
  // a game, so recents/pills of other games hide on switch and reappear on
  // switch-back (recents storage itself is untouched). Client-side filter
  // keeps the single-flight cache — no refetch on game change.
  const gameId = useActiveGameId();
  const { rows: segmentRows } = useSegmentRows();
  const gameSegmentRows = React.useMemo(
    () => filterRowsByGame(segmentRows, gameId),
    [segmentRows, gameId],
  );
  const segmentIds = React.useMemo(
    () => (gameSegmentRows ? new Set(gameSegmentRows.map((s) => s.id)) : null),
    [gameSegmentRows],
  );
  const sharedSegments = React.useMemo(
    () => selectSharedSegments(gameSegmentRows, 4),
    [gameSegmentRows],
  );
  // Built from the UNCAPPED shared set — a teammate-shared segment past the
  // display cap must still be excluded from recents (never shown un-pilled).
  const sharedSegmentIds = React.useMemo(
    () => new Set(selectSharedSegments(gameSegmentRows, Infinity).map((s) => s.id)),
    [gameSegmentRows],
  );
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
        // Right corners are squared so the sidebar sits flush against the main
        // card; the seam between them is the SidebarEdgeToggle (rendered as a
        // sibling in the shell layout), not a gap or border.
        borderRadius: '18px 0 0 18px',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: T.fSans,
        overflow: 'hidden',
        position: 'relative',
        transition: 'width 0.16s ease',
        willChange: 'width',
      }}
    >
      <WorkspacePill collapsed={collapsed} />

      <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 0 12px' }}>
        {showSection('chats') && (
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

        {showSection('playground') && (
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

        {showSection('data-model') && (
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

        {showSection('metrics-catalog') && (
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

        {showSection('liveops') && (
          <SidebarSection
            id="liveops"
            icon={Radio}
            label={t('nav.liveops')}
            to="/liveops"
            collapsed={collapsed}
          >
            <SidebarItem label={t('nav.cohortRetention')} to="/liveops/cohort" indent />
            <SidebarItem label={t('nav.anomalyArchive')} to="/liveops/anomalies" indent />
          </SidebarSection>
        )}

        {showSection('dashboards') && (
          <SidebarSection
            id="dashboards"
            icon={LayoutGrid}
            label={t('nav.dashboards')}
            to="/dashboards"
            collapsed={collapsed}
          >
            <SidebarItem
              label={t('nav.csVipCare')}
              to="/dashboards/cs"
              icon={Heart}
              iconColor="var(--brand)"
              indent
            />
            {/* Ops Console — only for games whose four ops data layers exist. */}
            {isOpsGame(gameId) && (
              <SidebarItem
                label={t('nav.opsConsole')}
                to="/ops"
                icon={Gauge}
                iconColor="var(--brand)"
                indent
              />
            )}
          </SidebarSection>
        )}

        {showSection('segments') && (
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
              // Shared rows are also excluded — a teammate's segment the
              // viewer visited would otherwise render twice (recent + pill).
              filter={(item) =>
                item.title !== item.id &&
                !sharedSegmentIds.has(item.id) &&
                (segmentIds === null || segmentIds.has(item.id))
              }
            />
            {/* Segments shared WITH the viewer — same row shape as recents,
                marked with the always-visible pill (owner in its tooltip). */}
            {sharedSegments.map((s) => (
              <SidebarItem
                key={s.id}
                label={s.name}
                to={`/segments/${s.id}`}
                indent
                muted
                trailing={<SharedPill ownerLabel={s.owner_label ?? s.owner} />}
              />
            ))}
          </SidebarSection>
        )}

        {showSection('advisor') && (
          <SidebarSection
            id="advisor"
            icon={Lightbulb}
            label={t('nav.advisor')}
            to="/advisor"
            collapsed={collapsed}
            flat
          />
        )}
      </nav>

      <BottomRow collapsed={collapsed} />
    </aside>
  );
}
