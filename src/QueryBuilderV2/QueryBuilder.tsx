import { Alert, Block, Card, PrismCode, Title } from '@cube-dev/ui-kit';
import cube, { Query } from '@cubejs-client/core';
import { useEffect, useMemo, useRef, ReactNode } from 'react';

import { QueryBuilderContext } from './context';
import { useEvent, useLocalStorage } from './hooks';
import {
  PlaygroundStoreContext,
  QbUiStoreContext,
  createPlaygroundStore,
  createQbUiStore,
  type PlaygroundStore,
  type QbUiStore,
} from '../stores';
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

  // C1 (red team): per-instance Zustand stores. Each <QueryBuilder> gets
  // its own factory-created pair so two tabs cannot collapse onto a shared
  // singleton. Phase 3 plumbs the providers; Phase 5 migrates consumers.
  const playgroundStoreRef = useRef<PlaygroundStore | null>(null);
  if (!playgroundStoreRef.current) {
    playgroundStoreRef.current = createPlaygroundStore();
  }
  const qbUiStoreRef = useRef<QbUiStore | null>(null);
  if (!qbUiStoreRef.current) {
    qbUiStoreRef.current = createQbUiStore();
  }

  // H5: one-way mirror from props → store (apiToken / apiUrl). Existing
  // AppContext-based consumers continue to read AppContext until Phase 5
  // migrates them; this write keeps the store in sync so post-migration
  // selectors see the same values.
  useEffect(() => {
    playgroundStoreRef.current?.getState().setApiToken(apiToken ?? null);
    playgroundStoreRef.current?.getState().setApiUrl(apiUrl ?? null);
  }, [apiToken, apiUrl]);

  const [storedTimezones] = useLocalStorage<string[]>('QueryBuilder:timezones', []);

  function queryValidator(query: Query) {
    // structuredClone is ~3× faster than JSON.parse(JSON.stringify(...)) and
    // is safe here because Query is plain-data — no functions / refs / DOM.
    const queryCopy = structuredClone(query);

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
  // `?time=<dim>.<granularity>`, and `?range=<cube native string>`.
  //
  // H9 (red team): The handler is split across two effects. A mount-only
  // listener catches `hashchange` events as soon as <QueryBuilder> exists
  // (including the race where lazy chunk resolves → mount → user pastes a
  // Try-It URL → hashchange fires BEFORE meta finishes loading). When meta
  // is not yet ready we buffer the event; once meta arrives we drain.
  const pendingHashRef = useRef(false);
  const metaReadyRef = useRef(false);

  const applyFromHash = useEvent(() => {
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
  });

  // Mount-only listener: registers immediately so no `hashchange` is lost in
  // the gap between mount and meta-load completion.
  useEffect(() => {
    function onHashChange() {
      if (metaReadyRef.current) {
        applyFromHash();
      } else {
        pendingHashRef.current = true;
      }
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [applyFromHash]);

  // Drain: once meta resolves, apply the current URL hash and any pending
  // hashchange that fired during the load window.
  useEffect(() => {
    if (!meta) return;
    metaReadyRef.current = true;
    applyFromHash();
    if (pendingHashRef.current) {
      pendingHashRef.current = false;
      applyFromHash();
    }
  }, [meta, applyFromHash]);

  // Phase 5.0 surgical fix: memo the Provider value so external renders
  // (theme, locale, hashchange-only navigations) do not force 80+ consumers
  // across 37 files to re-render via a fresh-each-render object literal.
  // Deps mirror the spread shape; identity changes when any slice actually
  // moves, which is exactly the only time downstream needs to re-render.
  const contextValue = useMemo(
    () => ({
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
    }),
    [
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
      otherProps,
    ]
  );

  if (!apiToken || !cubeApi || !apiUrl) {
    return null;
  }

  return (
    <PlaygroundStoreContext.Provider value={playgroundStoreRef.current}>
      <QbUiStoreContext.Provider value={qbUiStoreRef.current}>
        <QueryBuilderContext.Provider value={contextValue}>
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
      </QbUiStoreContext.Provider>
    </PlaygroundStoreContext.Provider>
  );
}
