import {
  Badge,
  Button,
  DialogContainer,
  Flex,
  Radio,
  Panel,
  SearchInput,
  Space,
  tasty,
  Text,
  Title,
  CloseIcon,
  TooltipProvider,
  ClearIcon,
} from '@cube-dev/ui-kit';
import {
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { EditOutlined, LoadingOutlined, StarFilled, StarOutlined } from '@ant-design/icons';

import {
  useDebouncedValue,
  useFilteredCubes,
  useEvent,
  useSidebarDisplayConfig,
} from './hooks';
import { useQueryBuilderContext } from './context';
import { PerfProbe } from '../dev/perf-probe';
import { EditQueryDialogForm } from './components/EditQueryDialogForm';
import { SidePanelCubeItem } from './components/SidePanelCubeItem';
import { SidebarDisplayPanel } from './components/SidebarDisplayPanel';
import { TagFilterChips } from './components/tag-filter-chips';
import { validateQuery } from './utils';

// Sticky preference for the All-members / Used-only toggle. QueryTabs remounts
// via key={gameId} on game switch, which would otherwise reset this toggle to
// its default every time the user picks a different game.
const VIEW_MODE_STORAGE_KEY = 'gds-cube:qb-view-mode';
type SidePanelViewMode = 'all' | 'query';

function readPersistedViewMode(): SidePanelViewMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return v === 'all' || v === 'query' ? v : null;
  } catch {
    return null;
  }
}

function persistViewMode(v: SidePanelViewMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, v);
  } catch {
    // ignore quota / private mode
  }
}

const RadioButton = tasty(Radio.Button, {
  styles: { flexGrow: 1, placeItems: 'stretch' },
  inputStyles: { textAlign: 'center' },
});

const CountBadge = tasty(Badge, {
  styles: {
    fill: '#purple',
    border: '#purple',
    color: '#white',
    padding: '0 1ow',
  },
});

type Props = {
  defaultSelectedType?: 'cubes' | 'views';
  customTypeSwitcher?: ReactNode;
  showEditQueryButton?: boolean;
};

export function QueryBuilderSidePanel({
  defaultSelectedType = 'cubes',
  customTypeSwitcher = null,
  showEditQueryButton = true,
}: Props) {
  const {
    query,
    cubes: cubesAndViews = [],
    selectCube,
    isQueryEmpty,
    joinableCubes,
    isCubeUsed,
    meta,
    isVerifying,
    clearQuery,
    setQuery,
    usedCubes,
    usedMembers,
    queryStats,
    members,
    missingCubes,
    apiVersion,
    isMetaLoading,
    memberViewType,
  } = useQueryBuilderContext();

  const contentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollToCubeName, setScrollToCubeName] = useState<string | null>(null);

  // Restore the user's last explicit toggle choice across remounts (e.g. game
  // switch via QueryTabs key={gameId}). Falls back to the legacy heuristic
  // (all-when-empty / query-when-non-empty) only if no preference is stored.
  const [viewMode, setViewMode] = useState<SidePanelViewMode>(
    () => readPersistedViewMode() ?? (!usedCubes.length ? 'all' : 'query'),
  );
  // The auto-reset effect below flips viewMode to 'all' when the query becomes
  // empty so the user isn't left looking at a blank "Used only" panel. On the
  // FIRST run after mount that would clobber a freshly restored 'query'
  // preference (the new game starts with an empty query), so we suppress it
  // exactly once per mount.
  const skipFirstEmptyAutoResetRef = useRef(true);
  const [isPasteDialogOpen, setIsPasteDialogOpen] = useState(false);
  const [filterString, setFilterString] = useState('');

  const [selectedType, setSelectedType] = useState<'cubes' | 'views'>(defaultSelectedType);

  const cubes = cubesAndViews.filter((item) => item.type === 'cube');
  const views = cubesAndViews.filter((item) => item.type === 'view');

  const allCubeNames = useMemo(
    () => cubesAndViews.map((c) => c.name),
    [cubesAndViews]
  );
  const displayConfig = useSidebarDisplayConfig(allCubeNames);

  const preparedFilterString = filterString.trim().toLowerCase();
  const debouncedFilterString = useDebouncedValue(preparedFilterString, 500);
  const appliedFilterString = preparedFilterString.length < 2 ? '' : debouncedFilterString;

  // H1 (red team): stabilize upstream array identities BEFORE adding them
  // to the cubeList memo deps. Without this, the deps thrash on every
  // render and the memo is strictly worse than no-memo.
  const cubesOrViewsAll = useMemo(
    () => (selectedType === 'cubes' ? cubes : views),
    [selectedType, cubes, views]
  );
  const cubesOrViewsFiltered = useMemo(
    () =>
      cubesOrViewsAll.filter(
        (cube) => displayConfig.isVisible(cube.name) || usedCubes.includes(cube.name)
      ),
    [cubesOrViewsAll, displayConfig, usedCubes]
  );

  const [openCubes, setOpenCubes] = useState<Set<string>>(new Set());

  useLayoutEffect(() => {
    if (isQueryEmpty) {
      setOpenCubes(
        cubesOrViewsFiltered.length === 1
          ? new Set([cubesOrViewsFiltered[0].name])
          : new Set()
      );
    }
  }, [cubesOrViewsFiltered.length, selectedType]);

  const highlightedCubes = useMemo(
    () => (appliedFilterString ? usedCubes : []),
    [appliedFilterString, usedCubes]
  );

  // Non-mutating sort: replaces `arr.sort(...)` which mutated the filtered
  // array in-place every render. The copy is cheap; the contract win is
  // that downstream identity now reflects "did the sort key change", not
  // "did we re-render".
  const cubesOrViews = useMemo(() => {
    const copy = [...cubesOrViewsFiltered];
    copy.sort((a, b) => {
      if (highlightedCubes.includes(a.name) && !highlightedCubes.includes(b.name)) {
        return -1;
      }
      if (!highlightedCubes.includes(a.name) && highlightedCubes.includes(b.name)) {
        return 1;
      }
      return memberViewType === 'name'
        ? a.name.localeCompare(b.name)
        : a.title.localeCompare(b.title);
    });
    return copy;
  }, [cubesOrViewsFiltered, highlightedCubes, memberViewType]);

  const allJoinableCubes = useMemo(
    () =>
      selectedType === 'views' && usedCubes.length
        ? cubesOrViews.filter((cube) => usedCubes[0] === cube.name)
        : cubesOrViews.filter((cube) => joinableCubes.includes(cube)),
    [selectedType, usedCubes, cubesOrViews, joinableCubes]
  );

  // Filtered cubes — useFilteredCubes already memoizes internally; only the
  // trailing `.map(c => c.name)` was unmemoized.
  const filteredCubesResult = useFilteredCubes(
    appliedFilterString,
    allJoinableCubes,
    memberViewType
  );
  const filteredCubes = useMemo(
    () => filteredCubesResult.cubes.map((cube) => cube.name),
    [filteredCubesResult]
  );

  const resetScrollAndContentSize = useCallback(() => {
    if (contentRef?.current) {
      const element = contentRef.current;

      element.scrollTop = 0;

      setTimeout(() => {
        element.scrollTop = 0;
      }, 0);
    }
  }, [contentRef?.current]);

  useEffect(() => {
    resetScrollAndContentSize();

    if (appliedFilterString && viewMode === 'query') {
      setViewMode('all');
    }
  }, [selectedType, appliedFilterString, meta]);

  useEffect(() => {
    const usedView = views.find((cube) => isCubeUsed(cube.name));
    const usedCube = cubes.find((cube) => isCubeUsed(cube.name));

    if (selectedType === 'cubes' && usedView && !usedCube) {
      setSelectedType('views');
      selectCube(usedView?.name);
    } else if (selectedType === 'views' && usedCube) {
      setSelectedType('cubes');
    }
  }, [selectedType, query]);

  const switchType = useCallback(
    async (type: 'cubes' | 'views') => {
      setSelectedType(type);
    },
    [isQueryEmpty]
  );

  const editQueryButton = useMemo(
    () => (
      <Button
        qa="EditQueryButton"
        aria-label="Edit Query"
        type="primary"
        size="small"
        icon={<EditOutlined />}
        onPress={() => setIsPasteDialogOpen(true)}
      />
    ),
    []
  );

  const displayPanelTrigger = (
    <SidebarDisplayPanel
      cubes={cubesOrViewsAll.map((c) => ({
        name: c.name,
        title: c.title,
        type: selectedType === 'cubes' ? 'cube' : 'view',
      }))}
      isVisible={displayConfig.isVisible}
      onToggle={displayConfig.toggleCube}
      onSetAll={displayConfig.setAll}
    />
  );

  const typeSwitcher = useMemo(() => {
    return (
      <Space qa="QueryBuilderSwitcher" gap="1x">
        {editQueryButton}
        <Radio.ButtonGroup
          aria-label="Cube type"
          value={selectedType}
          styles={{ flexGrow: 1 }}
          onChange={(val) => switchType(val as 'cubes' | 'views')}
        >
          <RadioButton
            qa="QueryBuilderTab-cubes"
            value="cubes"
            isDisabled={!cubes.length}
            inputStyles={{ placeContent: 'center' }}
          >
            Cubes <CountBadge radius="1r">{cubes.length}</CountBadge>
          </RadioButton>
          <RadioButton
            qa="QueryBuilderTab-views"
            value="views"
            isDisabled={!views.length}
            inputStyles={{ placeContent: 'center' }}
          >
            Views <CountBadge radius="1r">{views.length}</CountBadge>
          </RadioButton>
        </Radio.ButtonGroup>
        {displayPanelTrigger}
      </Space>
    );
  }, [
    selectedType,
    meta,
    cubes.length,
    views.length,
    cubesOrViewsAll,
    displayConfig.isVisible,
  ]);

  const searchInput = useMemo(() => {
    const description = `Search ${selectedType === 'cubes' ? 'cubes' : 'views'} and members`;

    return (
      <SearchInput
        isClearable
        qa="QueryBuilderSearch"
        size="small"
        aria-label={description}
        placeholder={description}
        value={filterString}
        onChange={(val) => setFilterString(val)}
      />
    );
  }, [selectedType, meta, filterString]);

  useEffect(() => {
    if (scrollToCubeName) {
      setTimeout(() => {
        const element = containerRef.current?.querySelector(
          `[data-qa="CubeButton"][data-qaval="${scrollToCubeName}"]`
        );

        if (element) {
          element.scrollIntoView({
            block: 'start',
          });
        }
      });

      setScrollToCubeName(null);
    }
  }, [scrollToCubeName]);

  // Close all disabled cubes to avoid layout shift on deselecting member.
  useEffect(() => {
    const currentSize = openCubes.size;
    const allJoinableCubeNames = allJoinableCubes.map((cube) => cube.name);

    openCubes.forEach((cubeName) => {
      if (!allJoinableCubeNames.includes(cubeName) && !missingCubes.includes(cubeName)) {
        openCubes.delete(cubeName);
      }
    });

    if (currentSize !== openCubes.size) {
      setOpenCubes(new Set(openCubes));
    }
  }, [openCubes.size, missingCubes.length, allJoinableCubes.length]);

  const resetState = useEvent((cubeName?: string) => {
    setFilterString('');
    setViewMode('all');

    if (cubeName) {
      setOpenCubes(new Set([cubeName]));
      setScrollToCubeName(cubeName);
    }
  });

  const onCubeToggle = useEvent((name: string, isOpen: boolean) => {
    if (appliedFilterString || viewMode === 'query') {
      resetState(name);
      return;
    }

    if (isOpen) {
      openCubes.add(name);
    } else {
      openCubes.delete(name);
    }

    setOpenCubes(new Set(openCubes));
  });

  const onMemberToggle = useEvent((cubeName: string, memberName: string) => {
    const isTimeDimension = members.dimensions[memberName]?.type === 'time';

    // Always reset state if we click on time dimension
    if (isTimeDimension || (appliedFilterString && !usedMembers.includes(memberName))) {
      resetState(cubeName);
    }
  });

  const onHierarchyToggle = useEvent((cubeName?: string) => {
    if (appliedFilterString || viewMode === 'query') {
      resetState(cubeName);
    }
  });

  // Stable per-cube callbacks: feeds React.memo'd <SidePanelCubeItem> so a
  // member toggle in cube X does not invalidate cube Y's callback identity.
  // The map is keyed by cube name; entries are recomputed only when the
  // cube list itself changes (allCubeNames is memoized above).
  const memberToggleHandlers = useMemo(() => {
    const map = new Map<string, (memberName: string) => void>();
    for (const cubeName of allCubeNames) {
      map.set(cubeName, (memberName: string) =>
        onMemberToggle(cubeName, memberName)
      );
    }
    return map;
  }, [allCubeNames, onMemberToggle]);

  const cubeToggleHandlers = useMemo(() => {
    const map = new Map<string, (isOpen: boolean) => void>();
    for (const cubeName of allCubeNames) {
      map.set(cubeName, (isOpen: boolean) => onCubeToggle(cubeName, isOpen));
    }
    return map;
  }, [allCubeNames, onCubeToggle]);

  const cubeList = useMemo(() => {
    return (
      <Flex gap="1bw" flow="column" padding="0 0 2x 0">
        {missingCubes
          .filter((cubeName) => (appliedFilterString ? filteredCubes.includes(cubeName) : true))
          .map((cubeName) => (
            <SidePanelCubeItem
              key={cubeName}
              isOpen={openCubes.has(cubeName)}
              filterString={appliedFilterString}
              cubeName={cubeName}
              mode={viewMode}
              rightIcon="arrow"
              onHierarchyToggle={onHierarchyToggle}
              onMemberToggle={memberToggleHandlers.get(cubeName)!}
            />
          ))}
        {cubesOrViews
          .filter((cube) =>
            appliedFilterString
              ? // If filter is applied, show only filtered cubes
                filteredCubes.includes(cube.name)
              : viewMode === 'query'
                ? // In query mode, show only used cubes
                  usedCubes.includes(cube.name)
                : true
          )
          .map((cube) => (
            <SidePanelCubeItem
              key={cube.name}
              isNonJoinable={!allJoinableCubes.includes(cube) && !usedCubes.includes(cube.name)}
              isOpen={openCubes.has(cube.name)}
              filterString={appliedFilterString}
              cubeName={cube.name}
              mode={viewMode}
              rightIcon={isQueryEmpty ? 'arrow' : 'plus'}
              onToggle={cubeToggleHandlers.get(cube.name)!}
              onMemberToggle={memberToggleHandlers.get(cube.name)!}
              onHierarchyToggle={onHierarchyToggle}
            />
          ))}
      </Flex>
    );
    // H1: deps now fully cover the cubeList's reads. The upstream arrays
    // (`missingCubes`, `cubesOrViews`, `filteredCubes`, `allJoinableCubes`,
    // `usedCubes`) are stabilized above; the openCubes hash captures Set
    // membership without leaking identity on every render.
  }, [
    missingCubes,
    cubesOrViews,
    filteredCubes,
    allJoinableCubes,
    usedCubes,
    viewMode,
    queryStats,
    Array.from(openCubes).sort().join('|'),
    appliedFilterString,
    memberViewType,
    isQueryEmpty,
    memberToggleHandlers,
    cubeToggleHandlers,
    onHierarchyToggle,
  ]);

  const onApplyQuery = useCallback(async (query) => {
    try {
      const validatedQuery = validateQuery(query);

      setQuery(validatedQuery);
    } catch (e: any) {
      throw 'Invalid query';
    }
  }, []);

  useEffect(() => {
    if (viewMode === 'query') {
      if (filterString) {
        setFilterString('');
      }

      setOpenCubes(new Set(usedCubes));

      setScrollToCubeName(usedCubes[0]);

      if (isQueryEmpty && !skipFirstEmptyAutoResetRef.current) {
        setViewMode('all');
      }
    }
    skipFirstEmptyAutoResetRef.current = false;
  }, [viewMode, isQueryEmpty]);

  const topBar = useMemo(() => {
    return (
      <Space placeContent="space-between" gap="1x">
        <Space gap="1x">
          {showEditQueryButton ? editQueryButton : null}
          {!usedCubes.length ? (
            <Title preset="h6">All members</Title>
          ) : (
            <TooltipProvider
              title={'Toggle between all members and only those that are used in the query'}
              placement="top"
            >
              <Button
                qa="ToggleMembersButton"
                qaVal={viewMode === 'all' ? 'all' : 'used'}
                type={viewMode === 'all' ? 'outline' : 'primary'}
                size="small"
                icon={viewMode === 'all' ? <StarOutlined /> : <StarFilled />}
                onPress={() => {
                  const next: SidePanelViewMode = viewMode === 'all' ? 'query' : 'all';
                  setViewMode(next);
                  persistViewMode(next);
                }}
              >
                {viewMode === 'all' ? 'All members' : 'Used only'}
              </Button>
            </TooltipProvider>
          )}
          {isVerifying || isMetaLoading ? <LoadingOutlined /> : null}
        </Space>
        <Space gap=".5x">
          <TooltipProvider title="Reset the query">
            <Button
              qa="ResetQuery"
              aria-label="Reset the query"
              size="small"
              type="secondary"
              theme="danger"
              icon={<ClearIcon />}
              onPress={() => {
                clearQuery();
                setOpenCubes(
                  cubesOrViews.length === 1 ? new Set([cubesOrViews[0].name]) : new Set()
                );
                resetScrollAndContentSize();
              }}
            >
              Reset
            </Button>
          </TooltipProvider>
          {displayPanelTrigger}
        </Space>
      </Space>
    );
  }, [
    viewMode,
    isQueryEmpty,
    isMetaLoading,
    usedMembers.length,
    appliedFilterString,
    isVerifying,
    cubesOrViewsAll,
    displayConfig.isVisible,
  ]);

  const content = (
    <>
      <DialogContainer isOpen={isPasteDialogOpen} onDismiss={() => setIsPasteDialogOpen(false)}>
        <EditQueryDialogForm
          query={query}
          defaultType={'json'}
          apiVersion={apiVersion}
          onSubmit={onApplyQuery}
        />
      </DialogContainer>

      {!usedCubes.length ? <>{customTypeSwitcher ?? typeSwitcher}</> : topBar}

      {searchInput}

      {appliedFilterString && !filteredCubes.length ? (
        <Space
          placeContent="space-between"
          placeItems="baseline"
          border="top"
          margin="0 -1x"
          padding="1x 1x 0 1x"
        >
          {!filteredCubes.length ? (
            <Text preset="c2">
              No {selectedType === 'cubes' ? 'cubes' : 'views'} or members found
            </Text>
          ) : null}
        </Space>
      ) : undefined}

      <TagFilterChips />

      <Panel margin="0 -1x" border="top" flexGrow={1}>
        {cubeList}
      </Panel>
    </>
  );

  return (
    <PerfProbe id="QueryBuilderSidePanel">
      <Panel
        ref={containerRef}
        isFlex
        qa="QueryBuilderSidePanel"
        flow="column"
        padding="1x 1x 0 1x"
        gap="1x"
        width="100%"
        height="100%"
        innerStyles={{
          overflowX: 'clip',
        }}
      >
        {content}
      </Panel>
    </PerfProbe>
  );
}
