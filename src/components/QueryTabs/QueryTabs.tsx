import {
  ChartType,
  PivotConfig,
  Query,
  validateQuery,
} from '@cubejs-client/core';
import { Input, Tabs } from 'antd';
import equals from 'fast-deep-equal';
import { ReactNode, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';

import { event } from '../../events';
import { useLocalStorage } from '../../hooks';
import { useWorkspaceContext } from '../workspace-context';
import { QueryLoadResult } from '../ChartRenderer/ChartRenderer';
import { DrilldownModal } from '../DrilldownModal/DrilldownModal';
import { useChartRendererStateMethods } from './ChartRendererStateProvider';
import { pushRecent, removeRecent } from '../../shell/sidebar/recent-items-store';
import { summarizeQuery } from '../../shell/sidebar/query-summary';

const { TabPane } = Tabs;

export const StyledTabs = styled(Tabs)`
  margin-top: 0;
  display: grid;
  width: 100%;
  height: 100%;
  min-height: 0;
  max-width: 100%;
  grid-template-rows: min-content 1fr;
  overflow: hidden;

  & .ant-tabs-nav {
    padding: 0;
    margin: 0;
    overflow: hidden;
    background-color: var(--bg-card);
  }

  & .ant-tabs-nav-wrap {
    padding: 4px 8px 0;
  }

  & .ant-tabs-extra-content {
    padding: 4px 8px;
    place-self: start;
  }

  & .ant-tabs-tab {
    margin: 0 16px 0 0;
    padding: 4px 12px;
    position: relative;
  }

  & .ant-tabs-content-holder {
    position: relative;
    display: flex;
    min-height: 0;
  }

  & .ant-tabs-content {
    height: 100%;
    width: 100%;
    min-height: 0;
  }

  & .ant-tabs-tabpane-active {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  & .ant-tabs-tab {
    border-radius: var(--radius) var(--radius) 0 0 !important;
    /* editable-card tabs default to antd's cool grey fill / white active tab.
       Warm both: inactive sits a step recessed, the active tab matches the
       cream strip and is set apart by the brand underline below. */
    background: var(--bg-muted) !important;
    border-color: var(--border-card) !important;
  }

  & .ant-tabs-tab.ant-tabs-tab-active {
    background: var(--bg-card) !important;
  }

  & .ant-tabs-tab.ant-tabs-tab-active::after {
    content: '';
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: -1px;
    height: 2px;
    background: var(--brand);
    border-radius: 2px 2px 0 0;
    pointer-events: none;
  }

  & .ant-tabs-tab.ant-tabs-tab-active .ant-tabs-tab-btn {
    color: var(--brand);
  }
`;


type QueryTab = {
  id: string;
  query: Query;
  chartType?: ChartType;
  name?: string;
};

type QueryTabs = {
  activeId: string;
  tabs: QueryTab[];
};

type DrillDownConfig = {
  query?: Query | null;
  pivotConfig?: PivotConfig | null;
};

export type QueryTabsProps = {
  query: Query | null;
  children: (
    tab: QueryTab,
    saveTab: (tab: Omit<QueryTab, 'id'>) => void
  ) => ReactNode;
  sidebar?: ReactNode | null;
  onTabChange?: (tab: QueryTab) => void;
  /**
   * Active game id. Scopes the localStorage tab list per game so each game
   * keeps its own persistent tabs and a game switch swaps to a clean slate
   * (or that game's saved tabs) without leaking state across tenants.
   */
  gameId?: string | null;
  /**
   * Navigation identity for the `query` prop (e.g. a per-click nonce from
   * the deeplink URL). Folded into the applied-query key so the SAME query
   * arriving via a NEW navigation re-applies — reactivating its tab if one
   * still holds it, or opening a fresh tab if the user closed it. Without a
   * nonce, behavior is unchanged: a given query JSON applies once.
   */
  applyNonce?: string | null;
};

export function QueryTabs({
  query,
  children,
  sidebar = null,
  onTabChange,
  gameId,
  applyNonce,
}: QueryTabsProps) {
  const {
    setChartRendererReady,
    setQueryStatus,
    setQueryError,
    setResultSetExists,
    setQueryLoading,
    setBuildInProgress,
    setSlowQuery,
    setSlowQueryFromCache,
    setQueryRequestId,
  } = useChartRendererStateMethods();

  const [editableTabId, setEditableTabId] = useState<string>();
  const [editableTabValue, setEditableTabValue] = useState<string>('');
  const [ready, setReady] = useState<boolean>(false);
  // Scope tabs per (workspace, game) — cube refs are namespaced per workspace
  // (prod cube-dev prefixes with `<prefix>_`, local doesn't), so a tab built
  // on one workspace would 400 against the other's schema. `key={gameId}`
  // upstream already remounts on game switch; the workspace half guards the
  // remaining axis. Unknown ids fall back to stable buckets for boot/tests.
  const { workspaceId } = useWorkspaceContext();
  const storageKey = `queryTabs:${workspaceId || '__default__'}:${gameId ?? '__default__'}`;
  const [queryTabs, saveTabs] = useLocalStorage<QueryTabs>(storageKey, {
    activeId: '1',
    tabs: [
      {
        id: '1',
        query: query || {},
      },
    ],
  });

  const [drilldownConfig, setDrilldownConfig] = useState<DrillDownConfig>({});
  const lastAppliedQueryKey = useRef<string | null>(null);

  useEffect(() => {
    window['__cubejsPlayground'] = {
      ...window['__cubejsPlayground'],
      forQuery(queryId: string) {
        return {
          onChartRendererReady() {
            setChartRendererReady(queryId, true);
          },
          onQueryStart: () => {
            setQueryLoading(queryId, true);
          },
          onQueryLoad: ({ resultSet, error }: QueryLoadResult) => {
            let isAggregated;

            if (resultSet) {
              const { loadResponse } = resultSet.serialize();
              const {
                requestId,
                external,
                dbType,
                extDbType,
                usedPreAggregations = {},
              } = loadResponse.results[0] || {};

              if (requestId) {
                setQueryRequestId(queryId, requestId);
              }

              setSlowQueryFromCache(queryId, Boolean(loadResponse.slowQuery));
              Boolean(loadResponse.slowQuery) && setSlowQuery(queryId, false);
              setResultSetExists(queryId, true);

              isAggregated = Object.keys(usedPreAggregations).length > 0;

              event(
                isAggregated
                  ? 'load_request_success_aggregated:frontend'
                  : 'load_request_success:frontend',
                {
                  dbType,
                  ...(isAggregated ? { external } : null),
                  ...(external ? { extDbType } : null),
                }
              );

              const response = resultSet.serialize();
              const [result] = response.loadResponse.results;

              const preAggregationType = Object.values(
                result.usedPreAggregations || {}
              )[0]?.type;
              const transformedQuery = result.transformedQuery;

              setQueryStatus(queryId, {
                resultSet,
                error,
                isAggregated,
                preAggregationType,
                transformedQuery,
                extDbType,
                external,
              });
            }

            if (error) {
              setQueryStatus(queryId, null);
              setQueryError(queryId, error);
            }

            if (resultSet || error) {
              setQueryLoading(queryId, false);
            }
          },
          onQueryProgress: (progress) => {
            setBuildInProgress(
              queryId,
              Boolean(progress?.stage?.stage.includes('pre-aggregation'))
            );

            const isQuerySlow =
              progress?.stage?.stage.includes('Executing query') &&
              (progress.stage.timeElapsed || 0) >= 5000;

            setSlowQuery(queryId, isQuerySlow);
            isQuerySlow && setSlowQueryFromCache(queryId, false);
          },
          onQueryDrilldown: (query, pivotConfig) => {
            setDrilldownConfig({
              query,
              pivotConfig,
            });
          },
        };
      },
    };
  }, []);

  useEffect(() => {
    const currentTab = queryTabs.tabs.find(
      (tab) => tab.id === queryTabs.activeId
    );

    // Bind the URL query to a single "applied" key so deep-links from the
    // Catalog (which can reuse the same KeepAlive instance) always open a
    // fresh tab when the URL changes, and never re-trigger on re-renders
    // of an already-applied query. The applyNonce (per-navigation, e.g. a
    // chat "Open in Playground" click) is folded in so the same query JSON
    // re-applies on a NEW navigation — reopening a closed tab instead of
    // being swallowed by the once-per-query guard.
    const queryKey = query
      ? `${applyNonce ?? ''}|${JSON.stringify(validateQuery(query))}`
      : null;

    if (query && queryKey !== lastAppliedQueryKey.current) {
      // Consume the key even when the active tab already holds the query
      // (no-op apply). Leaving it stale would make a LATER effect re-run
      // (tab close / tab switch changes currentTab) fall into the apply
      // branch and resurrect a tab the user deliberately closed, or yank
      // the active tab back.
      lastAppliedQueryKey.current = queryKey;

      if (!equals(validateQuery(currentTab?.query), validateQuery(query))) {
        // If a tab already holds this exact query (e.g. user clicked a recent
        // in the sidebar tray), re-activate it rather than spawning a duplicate.
        // Otherwise the tab strip fills with copies of the same query every
        // time the user clicks the same recent.
        const normalized = validateQuery(query);
        const existing = queryTabs.tabs.find((t) =>
          equals(validateQuery(t.query), normalized)
        );

        if (existing) {
          if (existing.id !== queryTabs.activeId) {
            saveTabs({ ...queryTabs, activeId: existing.id });
          }
        } else {
          const id = getNextId();
          saveTabs({
            activeId: id,
            tabs: [...queryTabs.tabs, { id, query }],
          });
        }
      }
    }

    if (!ready) setReady(true);
  }, [ready, query, applyNonce]);

  useEffect(() => {
    if (ready && queryTabs.activeId) {
      const activeTab = queryTabs.tabs.find(
        (tab) => tab.id === queryTabs.activeId
      );
      activeTab && onTabChange?.(activeTab);
    }
  }, [ready, queryTabs.activeId]);

  // Mirror the active tab into the sidebar Playground tray. Q-number IS the
  // tab id so the in-page "Query 3" tab and the sidebar "Q3: …" row always
  // refer to the same thing — independent counters would drift the moment a
  // tab gets closed and its id slot is refilled.
  const activeTabSerialized = JSON.stringify(
    queryTabs.tabs.find((t) => t.id === queryTabs.activeId)?.query ?? null
  );
  useEffect(() => {
    const activeTab = queryTabs.tabs.find((t) => t.id === queryTabs.activeId);
    if (!activeTab?.query) return;
    const num = parseInt(activeTab.id, 10);
    if (!Number.isFinite(num)) return;
    const title = summarizeQuery(activeTab.query as any, num);
    if (!title) return;
    const validated = validateQuery(activeTab.query);
    const href = `/build?query=${JSON.stringify(validated)}`;
    // Dedup key is the tab id, not the query fingerprint — editing a query
    // mutates the content of the same slot, so the sidebar row should update
    // in place rather than spawning a new entry per edit.
    const id = activeTab.id;
    // Debounce so dragging chips around doesn't fill the tray with every
    // intermediate state; only the query the user lands on sticks.
    const timer = window.setTimeout(() => {
      pushRecent('playground', {
        id,
        title,
        updatedAt: new Date().toISOString(),
        href,
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [queryTabs.activeId, activeTabSerialized]);

  const { activeId, tabs } = queryTabs;

  function getNextId(): string {
    const ids = tabs.map(({ id }) => id);

    for (let index = 1; index <= tabs.length + 1; index++) {
      if (!ids.includes(index.toString())) {
        return index.toString();
      }
    }

    return (tabs.length + 1).toString();
  }

  function handleTabSave(tab: Omit<QueryTab, 'id'>) {
    saveTabs({
      ...queryTabs,
      tabs: tabs.map((currentTab) => {
        return activeId === currentTab.id
          ? {
              ...currentTab,
              ...tab,
            }
          : currentTab;
      }),
    });
  }

  function setTabName(tabId: string, name: string) {
    saveTabs({
      ...queryTabs,
      tabs: tabs.map((currentTab) => {
        return tabId === currentTab.id
          ? {
              ...currentTab,
              name
            }
          : currentTab;
      }),
    });
  }

  function setActiveId(activeId: string) {
    saveTabs({ activeId, tabs });
  }

  function handleDrilldownModalClose() {
    setDrilldownConfig({});
  }

  if (!ready || !queryTabs.activeId) {
    return null;
  }

  return (
    <StyledTabs
      data-testid="query-tabs"
      activeKey={activeId}
      type="editable-card"
      tabBarExtraContent={{
        right: sidebar,
      }}
      hideAdd={false}
      onChange={setActiveId}
      onEdit={(event) => {
        if (typeof event === 'string') {
          let closedIndex = Number.MAX_VALUE;
          const closedTab = tabs.find(({ id }) => id === event);
          const nextTabs = tabs.filter(({ id }, index) => {
            if (id === event) {
              closedIndex = index;
            }
            return id !== event;
          });

          // Mirror the close into the sidebar tray: closing a tab is the user
          // saying "I'm done with this query", so the recent should go too.
          if (closedTab) {
            try { removeRecent('playground', closedTab.id); } catch { /* noop */ }
          }

          saveTabs({
            activeId: nextTabs[Math.min(closedIndex, nextTabs.length - 1)].id,
            tabs: nextTabs,
          });
        } else {
          const nextId = getNextId();

          saveTabs({
            activeId: nextId,
            tabs: [
              ...tabs,
              {
                id: nextId,
                query: {},
              },
            ],
          });
        }
      }}
    >
      {tabs.map((tab) => (
        <TabPane
          key={tab.id}
          data-testid={`query-tab-${tab.id}`}
          closable={tabs.length > 1}
          tab={
            editableTabId === tab.id ? (
              <Input
                autoFocus
                size="small"
                value={editableTabValue}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setEditableTabId(undefined);

                    if (editableTabValue.trim()) {
                      setTabName(tab.id, editableTabValue.trim());
                      setEditableTabValue('');
                    }
                  }
                  e.stopPropagation();
                }}
                onChange={(e) => setEditableTabValue(e.target.value)}
                onBlur={() => {
                  if (editableTabValue.trim()) {
                    setTabName(tab.id, editableTabValue.trim());
                    setEditableTabValue('');
                  }
                  setEditableTabId(undefined);
                }}
              />
            ) : (
              <span
                style={{ userSelect: 'none' }}
                onDoubleClick={() => {
                  setEditableTabValue(tab.name || `Query ${tab.id}`);
                  setEditableTabId(tab.id);
                }}
              >
                {tab.name ? tab.name : `Query ${tab.id}`}
              </span>
            )
          }
        >
          {children(tab, handleTabSave)}
          {drilldownConfig.query ? (
            <DrilldownModal
              query={drilldownConfig.query}
              pivotConfig={drilldownConfig.pivotConfig}
              onClose={handleDrilldownModalClose}
            />
          ) : null}
        </TabPane>
      ))}
    </StyledTabs>
  );
}
