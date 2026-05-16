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

  // Catalog deep-link: when arriving via "Open in Playground" from /catalog,
  // the URL carries `?cube=<name>`. Once meta has loaded, select that cube and
  // strip the param so refreshes don't re-trigger selection.
  useEffect(() => {
    if (!meta) return;
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    const target = params.get('cube');
    if (!target) return;
    selectCube(target);
    params.delete('cube');
    const remaining = params.toString();
    const cleanHash = remaining
      ? `${window.location.hash.split('?')[0]}?${remaining}`
      : window.location.hash.split('?')[0];
    window.history.replaceState(null, '', cleanHash);
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
