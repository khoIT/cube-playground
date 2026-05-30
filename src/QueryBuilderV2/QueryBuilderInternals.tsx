import { Panel as UIPanel, tasty } from '@cube-dev/ui-kit';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { Panel as ResizablePanel } from 'react-resizable-panels';
import { ChartType } from '@cubejs-client/core';

import { AppPane, AppPaneGroup, AppResizeHandle, Card, PaneShell } from '../components/AppPanes';
import { QUERY_BUILDER_COLOR_TOKENS } from './color-tokens';
import { useServerPref } from '../hooks/use-server-pref';
import { useQueryBuilderContext } from './context';
import { Tabs, Tab } from './components/Tabs';
import { QueryBuilderFilters } from './QueryBuilderFilters';
import { QueryBuilderChart } from './QueryBuilderChart';
import { QueryBuilderResults } from './QueryBuilderResults';
import { QueryBuilderToolBarAlerts } from './QueryBuilderToolBar';
import { QueryBuilderGeneratedSQL } from './QueryBuilderGeneratedSQL';
import { QueryBuilderSQL } from './QueryBuilderSQL';
import { QueryBuilderRest } from './QueryBuilderRest';
import { QueryBuilderGraphQL } from './QueryBuilderGraphQL';
import { QueryBuilderSidePanel } from './QueryBuilderSidePanel';
import { QueryBuilderExtras } from './QueryBuilderExtras';
import { QueryStatePillBar } from './QueryStatePillBar';
import { AnalysisPanel } from './analysis/analysis-panel';
import { ChartSidePane } from './components/ChartSidePane';
import { PinToDashboardButton } from '../pages/Dashboards/pin-to-dashboard-button';
import { CompareContext } from './compare/compare-context';
import { CompareToggle } from './compare/compare-toggle';
import { useCompareResults } from './compare/use-compare-results';
import { readCompareFromUrl, writeCompareToUrl } from './compare/compare-url-codec';
import type { CompareSetting } from './compare/compare-url-codec';

const FIXED_SIDEBAR_WIDTH = 315;

const Divider = tasty({
  styles: {
    width: '100%',
    height: '1ow 1ow',
    fill: '#border',
  },
});

type Tab = 'results' | 'analysis' | 'generated-sql' | 'json' | 'graphql' | 'sql';

const QueryBuilderPanel = tasty(UIPanel, {
  isFlex: true,
  isStretched: true,
  qa: 'QueryBuilder',
  styles: {
    fill: '#white',

    ...QUERY_BUILDER_COLOR_TOKENS,
  },
});

const FixedLayout = styled.div`
  display: flex;
  width: 100%;
  height: 100%;
  padding: var(--pane-gap);
  gap: var(--pane-gap);
  background: var(--bg-app);
  box-sizing: border-box;
`;

const FixedSidebarShell = styled(PaneShell)`
  width: ${FIXED_SIDEBAR_WIDTH}px;
  flex: 0 0 ${FIXED_SIDEBAR_WIDTH}px;
`;

// No chrome — Query/Results panes inside provide their own card chrome.
const FixedCenterBare = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
`;

const FixedChartShell = styled(PaneShell)`
  flex: 0 0 420px;
  min-width: 0;
`;

const FixedChartRailShell = styled(PaneShell)`
  flex: 0 0 36px;
  min-width: 0;
`;

const CenterColumn = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  min-height: 0;
  gap: var(--pane-gap);
  box-sizing: border-box;
  overflow: hidden;
`;

const ResultsCard = styled(Card)`
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
`;

const CenterScroll = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const QueryBuilderInternals = memo(function QueryBuilderInternals() {
  const {
    disableSidebarResizing,
    chartType,
    setChartType,
    pivotConfig,
    updatePivotConfig,
    VizardComponent,
    apiToken,
    apiUrl,
    query,
    resultSet,
  } = useQueryBuilderContext();
  const [chartCollapsed, setChartCollapsed] = useServerPref<boolean>(
    'gds-cube:chart-pane-collapsed',
    false
  );
  const [tab, setTab] = useState<Tab>('results');
  const ref = useRef<HTMLDivElement>(null);

  // Compare mode state — initialised from URL on first render.
  const [compareSetting, setCompareSetting] = useState<CompareSetting>(
    () => readCompareFromUrl(),
  );

  const handleCompareChange = useCallback((next: CompareSetting) => {
    setCompareSetting(next);
    writeCompareToUrl(next);
  }, []);

  // Derive measures list for delta computation.
  const measures = useMemo(() => query?.measures ?? [], [JSON.stringify(query?.measures)]);

  // Run comparison query only when a mode is active and a result set is present.
  const compareInput = compareSetting
    ? {
        query,
        mode: compareSetting,
        apiUrl: apiUrl ?? null,
        currentToken: apiToken ?? null,
        currentResultSet: resultSet ?? null,
        measures,
      }
    : null;
  const compareState = useCompareResults(compareInput);

  const onChartTypeChange = useCallback(
    (value: ChartType) => {
      setChartType(value);
    },
    [setChartType]
  );
  const onPivotMove = useCallback(
    (arg: any) => updatePivotConfig.moveItem(arg),
    [updatePivotConfig]
  );
  const onPivotUpdate = useCallback(
    (arg: any) => updatePivotConfig.update(arg),
    [updatePivotConfig]
  );

  const ResultsAndSQL = useMemo(() => {
    return (
      <CompareContext.Provider value={{ compareSetting, compareState }}>
        <Divider />

        <Tabs
          activeKey={tab}
          extra={
            <>
              <QueryBuilderExtras />
              <CompareToggle value={compareSetting} onChange={handleCompareChange} />
              <PinToDashboardButton />
            </>
          }
          styles={{ padding: '0 1x' }}
          onChange={(tab: string) => setTab(tab as Tab)}
        >
          <Tab keepMounted id="results" title="Results">
            <QueryBuilderResults forceMinHeight />
          </Tab>
          <Tab id="analysis" title="Analysis">
            <AnalysisPanel />
          </Tab>
          <Tab id="generated-sql" title="SQL">
            <QueryBuilderGeneratedSQL />
          </Tab>
          <Tab id="sql" title="SQL API">
            <QueryBuilderSQL />
          </Tab>
          <Tab id="json" title="REST">
            <QueryBuilderRest />
          </Tab>
          <Tab id="graphql" title="GraphQL">
            <QueryBuilderGraphQL />
          </Tab>
        </Tabs>
      </CompareContext.Provider>
    );
    // compareSetting / compareState / handleCompareChange intentionally in dep array
    // so context value updates when compare mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, compareSetting, compareState, handleCompareChange]);

  const centerContent = (
    <CenterColumn ref={ref}>
      <QueryStatePillBar filterSlot={<QueryBuilderFilters inline />} />
      <QueryBuilderToolBarAlerts />
      <ResultsCard>
        <CenterScroll>{ResultsAndSQL}</CenterScroll>
      </ResultsCard>
    </CenterColumn>
  );

  const chartContent = (
    <ChartSidePane
      collapsed={chartCollapsed}
      onToggleCollapsed={setChartCollapsed}
      chartType={chartType}
      onChartTypeChange={onChartTypeChange}
      pivotConfig={pivotConfig}
      onPivotMove={onPivotMove}
      onPivotUpdate={onPivotUpdate}
      VizardComponent={VizardComponent}
      apiToken={apiToken}
      apiUrl={apiUrl}
      query={query}
    >
      <QueryBuilderChart />
    </ChartSidePane>
  );

  // disableSidebarResizing: fixed-width sidebar, no PanelGroup
  if (disableSidebarResizing) {
    return (
      <QueryBuilderPanel>
        <FixedLayout>
          <FixedSidebarShell>
            <QueryBuilderSidePanel />
          </FixedSidebarShell>
          <FixedCenterBare>{centerContent}</FixedCenterBare>
          {chartCollapsed ? (
            <FixedChartRailShell>{chartContent}</FixedChartRailShell>
          ) : (
            <FixedChartShell>{chartContent}</FixedChartShell>
          )}
        </FixedLayout>
      </QueryBuilderPanel>
    );
  }

  // Default: 3 resizable panes. Center is a bare Panel (no PaneShell chrome) so the
  // inner Query and Results cards each appear as their own pane.
  return (
    <QueryBuilderPanel>
      <AppPaneGroup autoSaveId="QueryBuilder:Panes" direction="horizontal">
        <AppPane id="sidebar" order={1} defaultSize={22} minSize={18} maxSize={35}>
          <QueryBuilderSidePanel />
        </AppPane>
        <AppResizeHandle />
        <ResizablePanel
          id="center"
          order={2}
          defaultSize={chartCollapsed ? 75 : 50}
          minSize={30}
        >
          {centerContent}
        </ResizablePanel>
        {chartCollapsed ? (
          <AppPane id="chart-rail" order={3} defaultSize={3} minSize={2.5} maxSize={4}>
            {chartContent}
          </AppPane>
        ) : (
          <>
            <AppResizeHandle />
            <AppPane id="chart" order={3} defaultSize={28} minSize={18} maxSize={45}>
              {chartContent}
            </AppPane>
          </>
        )}
      </AppPaneGroup>
    </QueryBuilderPanel>
  );
});

export { QueryBuilderInternals };
