import { Alert, Block, Card, PrismCode, Title } from '@cube-dev/ui-kit';
import cube, { Query } from '@cubejs-client/core';
import { useEffect, useMemo, ReactNode } from 'react';

import { QueryBuilderContext } from './context';
import { useLocalStorage } from './hooks';
import { useQueryBuilder } from './hooks/query-builder';
import { QueryBuilderInternals } from './QueryBuilderInternals';
import { QueryBuilderProps } from './types';
import { useCommitPress } from './utils/use-commit-press';
import { useAppContext } from '../hooks';

export function QueryBuilder(
  props: Omit<QueryBuilderProps, 'apiUrl'> & {
    displayPrivateItems?: boolean;
    apiUrl: string | null;
    children?: ReactNode;
  }
) {
  const {
    apiUrl,
    apiToken,
    defaultChartType,
    defaultPivotConfig,
    onQueryChange,
    defaultQuery,
    shouldRunDefaultQuery,
    schemaVersion,
    tracking,
    isApiBlocked,
    apiVersion,
    memberViewType,
    VizardComponent,
    RequestStatusComponent,
    openSqlRunner,
    displayPrivateItems,
    disableSidebarResizing,
  } = props;

  const cubeApi = useMemo(() => {
    return apiUrl && apiToken && apiToken !== 'undefined'
      ? cube(apiToken, {
          apiUrl,
        })
      : undefined;
  }, [apiUrl, apiToken]);

  const [storedTimezones] = useLocalStorage<string[]>('QueryBuilder:timezones', []);

  function queryValidator(query: Query) {
    const queryCopy = JSON.parse(JSON.stringify(query));

    // add the last stored timezone if the query is empty
    if (JSON.stringify(queryCopy) === '{}' && storedTimezones[0]) {
      queryCopy.timezone = storedTimezones[0];
    }

    return queryCopy;
  }

  const {
    runQuery,
    cubes,
    isCubeJoined,
    usedCubes,
    getCubeByName,
    meta,
    loadMeta,
    metaError,
    richMetaError,
    selectCube,
    selectedCube,
    setQuery,
    ...otherProps
  } = useQueryBuilder({
    cubeApi,
    apiUrl,
    apiToken,
    defaultQuery,
    defaultChartType,
    defaultPivotConfig,
    schemaVersion,
    onQueryChange,
    memberViewType,
    tracking,
    queryValidator,
    displayPrivateItems,
  });

  useEffect(() => {
    if (defaultQuery && shouldRunDefaultQuery && meta) {
      void runQuery();
    }
  }, [shouldRunDefaultQuery, meta]);

  useCommitPress(() => {
    return runQuery();
  }, true);

  // Expose loadMeta via AppContext so consumers outside the QB tree (e.g. the
  // New Metric wizard success handler) can trigger a meta re-fetch without
  // holding a direct reference to this hook's closure.
  const { setContext } = useAppContext();
  useEffect(() => {
    setContext({ refreshMeta: loadMeta });
    // No cleanup: the no-op default in AppContext is safe after unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMeta]);

  // Catalog deep-link: when arriving via "Open in Playground" or the Metric
  // Card "Try it" button, the URL carries `?cube=`, optionally `?measure=`,
  // `?time=<dim>.<granularity>`, and `?range=<cube native string>`. Captured
  // and applied via a `hashchange` subscription so we catch direct URL pastes
  // (which don't go through history.push and don't change location.key) as
  // well as in-app navigations.
  useEffect(() => {
    if (!meta) return;

    function applyFromHash() {
      const params = new URLSearchParams(
        window.location.hash.split('?')[1] ?? '',
      );
      const target = params.get('cube');
      if (!target) return false;
      selectCube(target);

      const measureParam = params.get('measure');
      const timeParam = params.get('time');
      const rangeParam = params.get('range');
      if (measureParam || timeParam) {
        const nextQuery: Query = {};
        if (measureParam) nextQuery.measures = [measureParam];
        if (timeParam) {
          const parts = timeParam.split('.');
          const granularity = parts.length >= 3 ? parts.pop()! : 'day';
          const dimension = parts.join('.');
          nextQuery.timeDimensions = [
            {
              dimension,
              granularity: granularity as any,
              ...(rangeParam ? { dateRange: rangeParam } : {}),
            },
          ];
        }
        setQuery(nextQuery);
      }

      // Strip deep-link params from URL so onQueryChange's own push doesn't
      // re-trigger on refresh and so the URL becomes shareable as `?query=...`.
      params.delete('cube');
      params.delete('measure');
      params.delete('time');
      params.delete('range');
      const remaining = params.toString();
      const cleanHash = remaining
        ? `${window.location.hash.split('?')[0]}?${remaining}`
        : window.location.hash.split('?')[0];
      window.history.replaceState(null, '', cleanHash);
      return true;
    }

    // Apply once on meta load (handles initial page load + address-bar paste).
    applyFromHash();

    // Subscribe to subsequent hash changes so Try-it / Open-in-Playground
    // navigations apply too, even when QueryBuilder was already KeepAlive-
    // mounted and `meta` doesn't change.
    function onHashChange() {
      applyFromHash();
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  if (!apiToken || !cubeApi || !apiUrl) {
    return null;
  }

  return (
    <QueryBuilderContext.Provider
      value={{
        runQuery,
        cubes,
        isCubeJoined,
        meta,
        loadMeta,
        metaError,
        richMetaError,
        selectedCube,
        selectCube,
        setQuery,
        usedCubes,
        getCubeByName,
        tracking,
        isApiBlocked,
        apiToken,
        apiUrl,
        apiVersion,
        VizardComponent,
        RequestStatusComponent,
        openSqlRunner,
        disableSidebarResizing,
        ...otherProps,
      }}
    >
      {!meta ? (
        <Block flexGrow={1} padding="2x">
          {!metaError ? (
            <Card>Loading meta information...</Card>
          ) : (
            <Alert theme="danger">
              <Title level={5}>Unable to load meta data.</Title>
              <PrismCode code={metaError} />
            </Alert>
          )}
        </Block>
      ) : props.children ? (
        props.children
      ) : (
        <QueryBuilderInternals />
      )}
    </QueryBuilderContext.Provider>
  );
}
