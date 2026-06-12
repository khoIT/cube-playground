import { Panel, Space } from '@cube-dev/ui-kit';
import { CubeProvider } from '@cubejs-client/react';
import { Card, message } from 'antd';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import styled from 'styled-components';

import { CubeLoader } from '../../atoms';
import { useActiveGameId } from '../Header/use-game-context';
import { useWorkspaceContext } from '../workspace-context';
import { useAppContext, useCubejsApi, useSecurityContext } from '../../hooks';
import {
  OPEN_ROLLUP_DESIGNER_EVENT,
  RollupDesignerContext,
  useRollupDesignerContext,
} from '../../rollup-designer';
import { applyGameFilter } from '../../shared/game-scoping/apply-game-filter';
import { normalizeQueryRelativeDateRanges } from '../../QueryBuilderV2/utils/normalize-relative-date-range';
import { ChartRendererStateProvider } from '../QueryTabs/ChartRendererStateProvider';
import { QueryTabs, QueryTabsProps } from '../QueryTabs/QueryTabs';
import {
  QueryBuilder,
  QueryBuilderProps,
  RequestStatusProps,
} from '../../QueryBuilderV2/index';
import {
  readDeeplinkFromStorage,
  readEditContextFromStorage,
  clearDeeplinkStorage,
} from '../../utils/playground-deeplink';
import type { SegmentEditContext } from '../../utils/playground-deeplink';
import { segmentsClient } from '../../api/segments-client';

import { PreAggregationStatus } from './components/index';
import { PlaygroundVizard } from './playground-vizard';
import {
  SegmentEditSessionContext,
  type SegmentEditSession,
} from './segment-edit-react-context';
import { PlaygroundEditSegmentBanner } from './playground-edit-segment-banner';

const StyledCard = styled(Card)`
  border-radius: 0;
  border-bottom: 1px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--layout-body-background);
  zoom: 0.88;

  & .ant-card-body {
    padding: 0;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
`;

function RequestStatusComponent({
  isAggregated,
  external,
  extDbType,
  preAggregationType,
}: RequestStatusProps) {
  return (
    <Space direction="vertical" gap="0" placeItems="end" margin="-1x 0">
      <PreAggregationStatus
        preAggregationType={preAggregationType}
        isAggregated={isAggregated}
        external={external}
        extDbType={extDbType}
      />
    </Space>
  );
}

/**
 * Editing context parsed from the ?edit-segment= param (+ sessionStorage
 * payload written by buildDefinitionDeeplink). Exposed on QueryBuilderContainer
 * so the save-back flow can read it via props or a shared context without
 * needing direct URL access.
 *
 * null means the playground was opened without a segment edit target.
 */
export type { SegmentEditContext };

type QueryBuilderContainerProps = Pick<
  QueryBuilderProps,
  | 'defaultQuery'
  | 'initialVizState'
  | 'schemaVersion'
  | 'extra'
  | 'onSchemaChange'
  | 'onQueryChange'
> &
  Pick<QueryTabsProps, 'onTabChange'> & {
    /** Called once on boot when an edit-segment context is resolved from the
     *  URL / sessionStorage. The save-back flow subscribes to this to
     *  display the editing banner and wire the Update action. */
    onEditContextReady?: (ctx: SegmentEditContext) => void;
  };

export function QueryBuilderContainer(props: QueryBuilderContainerProps) {
  const { apiUrl } = useAppContext();
  const { currentToken } = useSecurityContext();
  const gameId = useActiveGameId();

  // Active segment-edit session. Null = normal exploration mode.
  // Set when QueryTabsRenderer fires onEditContextReady (once per ?edit-segment= boot).
  // Cleared by banner ✕ or after a successful Update.
  const [editSession, setEditSession] = useState<SegmentEditSession | null>(null);

  // Re-evaluate game mismatch whenever the active game switches mid-session.
  // This ensures the guard is live, not just a one-shot boot check.
  useEffect(() => {
    setEditSession((prev) => {
      if (!prev) return prev;
      const mismatch = !!(prev.editContext.gameId && gameId && prev.editContext.gameId !== gameId);
      if (mismatch === prev.gameMismatch) return prev;
      return { ...prev, gameMismatch: mismatch };
    });
  }, [gameId]);

  useLayoutEffect(() => {
    if (apiUrl && currentToken) {
      window['__cubejsPlayground'] = {
        ...window['__cubejsPlayground'],
        apiUrl,
        token: currentToken,
      };
    }
  }, [apiUrl, currentToken]);

  const cubejsApi = useCubejsApi(apiUrl, currentToken);

  const handleEditContextReady = (ctx: SegmentEditContext) => {
    // gameMismatch is derived from the current gameId each render, so it
    // automatically re-evaluates when the user switches game mid-session.
    // We pass ctx into editSession; the mismatch flag is computed in the
    // SegmentEditSessionContext.Provider below from the live gameId.
    const mismatch = !!(ctx.gameId && gameId && ctx.gameId !== gameId);

    // Establish the session immediately with defaults so the banner renders
    // without waiting for the network fetch below.
    const exitFn = () => setEditSession(null);
    setEditSession({
      editContext: ctx,
      gameMismatch: mismatch,
      segmentType: null,      // resolved below after fetch
      canAdminister: false,   // safe default — unlocked after fetch
      exitEditMode: exitFn,
    });

    // Fetch segment metadata to determine type (manual vs predicate) and
    // whether the current user may administer it. Both affect save-bar controls.
    segmentsClient.get(ctx.segmentId).then((seg) => {
      setEditSession((prev) => {
        if (!prev || prev.editContext.segmentId !== ctx.segmentId) return prev;
        return {
          ...prev,
          segmentType: seg.type,
          canAdminister: seg.can_administer,
          // Refresh segmentName in case the context carried a blank name
          // (minimal-context path from the inline deeplink).
          editContext: prev.editContext.segmentName
            ? prev.editContext
            : { ...prev.editContext, segmentName: seg.name },
        };
      });
    }).catch(() => {
      // Fetch failed (404 / 403 / network): segment may be deleted or access
      // revoked. Drop edit mode rather than showing a permanently-disabled bar.
      setEditSession(null);
    });

    // Forward to any external consumer (e.g. tests, wrapping pages).
    props.onEditContextReady?.(ctx);
  };

  if (!cubejsApi) {
    return <CubeLoader />;
  }

  return (
    <SegmentEditSessionContext.Provider value={editSession}>
      <CubeProvider cubeApi={cubejsApi}>
        <RollupDesignerContext apiUrl={apiUrl!}>
          <ChartRendererStateProvider>
            <StyledCard bordered={false}>
              {editSession && (
                <PlaygroundEditSegmentBanner
                  segmentName={editSession.editContext.segmentName}
                  gameMismatch={editSession.gameMismatch}
                  onExit={() => setEditSession(null)}
                />
              )}
              <QueryTabsRenderer
                cubejsApi={cubejsApi}
                apiUrl={apiUrl!}
                token={currentToken!}
                extra={props.extra}
                schemaVersion={props.schemaVersion}
                onSchemaChange={props.onSchemaChange}
                onQueryChange={props.onQueryChange}
                onTabChange={props.onTabChange}
                onEditContextReady={handleEditContextReady}
              />
            </StyledCard>
          </ChartRendererStateProvider>
        </RollupDesignerContext>
      </CubeProvider>
    </SegmentEditSessionContext.Provider>
  );
}

type QueryTabsRendererProps = {
  apiUrl: string;
  token: string;
  cubejsApi: ReturnType<typeof useCubejsApi>;
  onEditContextReady?: (ctx: SegmentEditContext) => void;
} & Pick<
  QueryBuilderProps,
  'schemaVersion' | 'onSchemaChange' | 'onQueryChange' | 'extra'
> &
  Pick<QueryTabsProps, 'onTabChange'>;

function QueryTabsRenderer({
  apiUrl,
  token,
  cubejsApi,
  onQueryChange,
  onEditContextReady,
  ...props
}: QueryTabsRendererProps) {
  // useLocation subscribes to RouterContext, so SPA navigation back to
  // /build (after KeepAlive hides + reshows ExplorePage) triggers a
  // re-render — useHistory().location is a non-reactive snapshot and
  // would leave QueryTabsRenderer stale on the new URL.
  const location = useLocation();
  const history = useHistory();
  const { setQuery, toggleModal } = useRollupDesignerContext();
  const gameId = useActiveGameId();
  const { workspaceId } = useWorkspaceContext();

  useEffect(() => {
    const handler = () => toggleModal();
    window.addEventListener(OPEN_ROLLUP_DESIGNER_EVENT, handler);
    return () => window.removeEventListener(OPEN_ROLLUP_DESIGNER_EVENT, handler);
  }, [toggleModal]);

  // Build a predicate from the active /meta — a cube exposes `gameId` if it
  // lists a dimension named `<cube>.gameId`. We probe lazily so the call is
  // a noop until /meta has resolved.
  const cubeHasGameDim = useMemo(() => {
    let cache: Set<string> | null = null;
    return (cube: string): boolean => {
      if (!cache) {
        const meta = (cubejsApi as any)?.meta?.cubes ?? null;
        if (!meta) return false;
        cache = new Set<string>();
        for (const c of meta) {
          for (const d of c.dimensions ?? []) {
            if (typeof d?.name === 'string' && d.name.endsWith('.gameId')) {
              cache.add(d.name.split('.')[0]);
            }
          }
        }
      }
      return cache.has(cube);
    };
  }, [cubejsApi]);

  const params = new URLSearchParams(location.search);

  // --------------------------------------------------------------------------
  // ?from-chat-artifact=<id> — consume CubeQuery payload from sessionStorage.
  //
  // On first render with a given artifactId:
  //   - Key present  → parse, clear key, use as query (inline hydration).
  //   - Key missing  → show stale-link toast (user refreshed after key expired).
  // Does NOT affect existing ?query= or segment-edit flows.
  // --------------------------------------------------------------------------
  const chatArtifactId = params.get('from-chat-artifact');
  // Ref tracks which artifactId we already processed so we don't re-run on
  // every render while the URL still contains the param.
  const processedArtifactRef = useRef<string | null>(null);
  // Ref holds the parsed payload after the first successful read.
  const chatPayloadRef = useRef<Record<string, unknown> | null>(null);

  if (chatArtifactId && processedArtifactRef.current !== chatArtifactId) {
    // Mark as processed immediately (synchronous, before any render side-effects).
    processedArtifactRef.current = chatArtifactId;
    chatPayloadRef.current = null;

    const storageKey = `gds-cube:pending-chat-deeplink:${chatArtifactId}`;
    const raw = typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem(storageKey)
      : null;

    if (raw) {
      // Clear before parsing — prevents double-consume on strict-mode double render.
      sessionStorage.removeItem(storageKey);
      try {
        chatPayloadRef.current = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        chatPayloadRef.current = null;
      }
    } else {
      // Key absent: expired or was never written (e.g. user refreshed page).
      // Show warning via antd message (non-blocking).
      message.warning(
        'This chat link has expired — return to the chat to re-open it.',
        4,
      );
    }
  }

  // --------------------------------------------------------------------------
  // ?from-segment=<id> — consume a definition or uid-IN query stashed in
  // sessionStorage by buildDefinitionDeeplink / buildPlaygroundDeeplink.
  //
  // On first render with a given segmentId:
  //   - Key present  → parse, clear key, use as query.
  //   - Key missing  → show stale-link toast.
  // Composes with ?edit-segment= below: both params may appear together when
  // buildDefinitionDeeplink falls back to sessionStorage for large definitions.
  // --------------------------------------------------------------------------
  const fromSegmentId = params.get('from-segment');
  const processedFromSegmentRef = useRef<string | null>(null);
  const fromSegmentPayloadRef = useRef<Record<string, unknown> | null>(null);

  if (fromSegmentId && processedFromSegmentRef.current !== fromSegmentId) {
    processedFromSegmentRef.current = fromSegmentId;
    fromSegmentPayloadRef.current = null;

    const stored = readDeeplinkFromStorage(fromSegmentId);
    if (stored) {
      // clearDeeplinkStorage also clears the edit-context key — we read the
      // edit context first below before clearing.
      fromSegmentPayloadRef.current = stored;
    } else {
      message.warning(
        'This segment link has expired — reopen it from the Segments page.',
        4,
      );
    }
  }

  // --------------------------------------------------------------------------
  // ?edit-segment=<id> — resolve edit context for segment round-trip.
  //
  // The edit context is either:
  //   (a) in sessionStorage (when buildDefinitionDeeplink used the overflow
  //       path and stashed it alongside the query), or
  //   (b) on the inline path, the edit context is in-memory inside
  //       buildDefinitionDeeplink's result — but since the URL alone carried
  //       the query, no sessionStorage write happened. In that case the
  //       context is reconstructed from the segment data by the caller; we
  //       still expose the segmentId so the save-back flow's save bar can fetch it.
  //
  // We only call onEditContextReady once per distinct segmentId.
  // --------------------------------------------------------------------------
  const editSegmentId = params.get('edit-segment');
  const processedEditSegmentRef = useRef<string | null>(null);
  const [editContext, setEditContext] = useState<SegmentEditContext | null>(null);

  if (editSegmentId && processedEditSegmentRef.current !== editSegmentId) {
    processedEditSegmentRef.current = editSegmentId;

    // buildDefinitionDeeplink always writes the edit context to sessionStorage
    // (both inline and oversize paths), keyed by segment id. Read it here to
    // get the full context (echoFilters, gameId from the deeplink-emission game).
    const storedCtx = readEditContextFromStorage(editSegmentId);

    // Now safe to clear both storage keys for this segment.
    clearDeeplinkStorage(editSegmentId);

    if (storedCtx) {
      // Defer state update to avoid setState-during-render.
      Promise.resolve().then(() => {
        setEditContext(storedCtx);
        onEditContextReady?.(storedCtx);
      });
    } else {
      // Context not in storage (link shared across sessions, or storage cleared).
      // Build a minimal context so the banner and segment fetch still work.
      // echoFilters will be empty — echo-strip is a best-effort in this fallback.
      const minimalCtx: SegmentEditContext = {
        segmentId: editSegmentId,
        segmentName: '',       // filled after segmentsClient.get fetch
        gameId: gameId ?? '',
        echoFilters: [],
        returnedFrom: 'segment-detail',
      };
      Promise.resolve().then(() => {
        setEditContext(minimalCtx);
        onEditContextReady?.(minimalCtx);
      });
    }
  }

  // --------------------------------------------------------------------------
  // Game guard: if the edit context carries a gameId that differs from the
  // currently active game, warn the user. Filters referencing cubes absent
  // from the booted /meta would silently no-op; a visible warning lets the
  // user switch games before relying on the query results.
  //
  // We emit the warning at most once per edit-segment session.
  // --------------------------------------------------------------------------
  const gameGuardedRef = useRef<string | null>(null);
  if (
    editContext &&
    editContext.gameId &&
    gameId &&
    editContext.gameId !== gameId &&
    gameGuardedRef.current !== editContext.segmentId
  ) {
    gameGuardedRef.current = editContext.segmentId;
    message.warning(
      `This segment was created for game "${editContext.gameId}" but you are currently viewing "${gameId}". ` +
      'Switch to the correct game workspace before saving changes.',
      6,
    );
  }

  // Resolve final query priority:
  //   1. chat-artifact payload (highest — explicit chat intent)
  //   2. from-segment payload (segment definition / uid-IN overflow)
  //   3. ?query= param (inline definition or arbitrary deeplink)
  //   4. null
  const queryParam = params.get('query');
  const rawQuery =
    (chatArtifactId && processedArtifactRef.current === chatArtifactId
      ? chatPayloadRef.current
      : null) ??
    (fromSegmentId && processedFromSegmentRef.current === fromSegmentId
      ? fromSegmentPayloadRef.current
      : null) ??
    JSON.parse(queryParam || 'null');

  // Rewrite "last N week/month/quarter/year" relative strings to rolling
  // [start, end] tuples before they reach Cube. Cube's date-parser snaps
  // these to completed calendar units and silently drops the current
  // period — the chat-side normalizer covers freshly-emitted URLs, this
  // one covers already-shared URLs and hand-edited ones.
  //
  // EXCEPTION: in edit mode (?edit-segment= present) the query was built
  // from the predicate tree, which intentionally carries relative date
  // strings (e.g. "last 30 days") so the segment re-anchors to "now" on
  // the next refresh. Normalizing them here would freeze the rolling window
  // before the user even edits anything, making save-back persist a literal
  // [start, end] tuple. Skip normalization for edit-mode queries.
  const isEditMode = !!editSegmentId;
  const normalizedQuery = isEditMode ? rawQuery : normalizeQueryRelativeDateRanges(rawQuery);
  const wasNormalized = normalizedQuery !== rawQuery;
  const query = applyGameFilter(normalizedQuery, gameId, cubeHasGameDim);

  // Stabilize the URL so the address bar reflects what's actually running:
  // rewrite ?query= to carry the explicit tuple. Skipped for the chat-
  // artifact path (?from-chat-artifact= preserves provenance — the
  // in-memory query is already normalized for execution). Guarded against
  // re-fires by depending on the raw query string; once replaced, the
  // next render sees the explicit tuple and wasNormalized goes false.
  // Preserve edit-segment in the URL so a reload mid-edit stays in edit mode.
  useEffect(() => {
    if (!wasNormalized) return;
    if (chatArtifactId) return;
    if (!queryParam || !normalizedQuery) return;
    const editParam = editSegmentId ? `&edit-segment=${encodeURIComponent(editSegmentId)}` : '';
    history.replace({ search: `?query=${encodeURIComponent(JSON.stringify(normalizedQuery))}${editParam}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryParam, wasNormalized, chatArtifactId, editSegmentId]);

  return (
    <QueryTabs
      // Remount on workspace change so the per-(workspace, game) storage key
      // is read fresh instead of carrying the prior workspace's tabs in memory.
      key={`${workspaceId || '_'}:${gameId}`}
      gameId={gameId}
      query={query}
      sidebar={null}
      onTabChange={(tab) => {
        props.onTabChange?.(tab);
        setQuery(tab.query);
      }}
    >
      {({ id, query, chartType }, saveTab) => (
        <Panel key={id} height="100% 100%" fill="#clear">
          <QueryBuilder
            apiUrl={apiUrl}
            apiToken={token}
            defaultQuery={applyGameFilter(query, gameId, cubeHasGameDim)}
            defaultChartType={chartType}
            schemaVersion={props.schemaVersion}
            extra={props.extra ?? null}
            RequestStatusComponent={RequestStatusComponent}
            VizardComponent={PlaygroundVizard}
            onSchemaChange={props.onSchemaChange}
            onQueryChange={(data) => {
              saveTab(data);
              onQueryChange?.(data);
            }}
          />
        </Panel>
      )}
    </QueryTabs>
  );
}
