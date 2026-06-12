/**
 * CubeGraphPage — join-topology overview of the active game's cubes, built
 * entirely from the extended /meta the Catalog dispatch already fetched and
 * passes down (no server endpoint, no second fetch). Toolbar (search / view
 * highlight / lint chip) + reactflow board + the existing DetailPanel on click.
 *
 * Default export so the Cubes surface can `React.lazy` it — reactflow stays
 * out of the main Catalog bundle (same chunk family as the Concept Map).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';

import { useActiveGameId } from '../../../components/Header/use-game-context';
import { useWorkspaceContext } from '../../../components/workspace-context';
import { resolveGamePrefix } from '../../../lib/cube-member-resolver';
import { DetailPanel } from '../detail-panel';
import { type CatalogCube } from '../use-catalog-meta';
import { buildJoinGraph } from './build-join-graph';
import { clusterGridLayout } from './cluster-grid-layout';
import { viewComposition } from './view-composition';
import { CubeGraphBoard } from './cube-graph-board';
import { CubeGraphToolbar } from './cube-graph-toolbar';

const Body = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
`;

const StatusLine = styled.div<{ $kind: 'info' | 'error' }>`
  padding: 16px 32px;
  font-size: 13px;
  font-family: var(--font-sans);
  color: ${(p) => (p.$kind === 'error' ? 'var(--danger)' : 'var(--text-muted)')};
`;

interface CubeGraphPageProps {
  cubes: CatalogCube[];
  loading: boolean;
  error: string | null;
}

export function CubeGraphPage({ cubes, loading, error }: CubeGraphPageProps) {
  const gameId = useActiveGameId();
  const { workspaceId, workspace } = useWorkspaceContext();
  const gamePrefix = resolveGamePrefix(workspace ?? null, gameId);

  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedView, setSelectedView] = useState<string | null>(null);
  const lintCycleIdx = useRef(0);

  // Selection / search / view highlight are model-specific — clear them when
  // the game or workspace changes so the toolbar never shows stale values.
  useEffect(() => {
    setSelected(null);
    setSearch('');
    setSelectedView(null);
    lintCycleIdx.current = 0;
  }, [gameId, workspaceId]);

  const graph = useMemo(() => buildJoinGraph(cubes, gamePrefix), [cubes, gamePrefix]);
  const layout = useMemo(() => clusterGridLayout(graph.nodes), [graph.nodes]);
  const composition = useMemo(() => viewComposition(cubes), [cubes]);
  const views = useMemo(
    () => cubes.filter((c) => c.type === 'view').map((c) => c.name),
    [cubes],
  );

  // Stats line + which clusters to show in the legend (present ones only).
  const presentClusters = useMemo(
    () => new Set(graph.nodes.map((n) => n.cluster)),
    [graph.nodes],
  );
  const joinCount = useMemo(
    () => graph.edges.filter((e) => !e.missingTarget).length,
    [graph.edges],
  );

  // Dim = search miss OR (a view is highlighted and the cube isn't in it).
  const dimmed = useMemo(() => {
    const out = new Set<string>();
    const q = search.trim().toLowerCase();
    const viewSet = selectedView ? composition.get(selectedView) : null;
    if (!q && !viewSet) return out;
    for (const n of graph.nodes) {
      const searchMiss =
        q.length > 0 && !n.name.toLowerCase().includes(q) && !n.title.toLowerCase().includes(q);
      const outsideView = viewSet != null && !viewSet.has(n.name);
      if (searchMiss || outsideView) out.add(n.name);
    }
    return out;
  }, [graph.nodes, search, selectedView, composition]);

  // Lint chip cycles selection through flagged cubes (isolated first).
  const flagged = useMemo(() => {
    const missingSources = [...new Set(graph.lints.missingTarget.map((m) => m.source))];
    return [...new Set([...graph.lints.isolated, ...missingSources])];
  }, [graph.lints]);

  const cycleLint = () => {
    if (flagged.length === 0) return;
    setSelected(flagged[lintCycleIdx.current % flagged.length]);
    lintCycleIdx.current += 1;
  };

  const selectedCube: CatalogCube | null = useMemo(
    () => cubes.find((c) => c.name === selected) ?? null,
    [cubes, selected],
  );
  const selectedCluster = useMemo(
    () => graph.nodes.find((n) => n.name === selected)?.cluster,
    [graph.nodes, selected],
  );

  const isEmpty = !loading && !error && graph.nodes.length === 0;

  return (
    <>
      {error && <StatusLine $kind="error">Failed to load meta: {error}</StatusLine>}
      {loading && <StatusLine $kind="info">Loading…</StatusLine>}

      {!loading && !error && (
        <CubeGraphToolbar
          search={search}
          onSearchChange={setSearch}
          views={views}
          selectedView={selectedView}
          onViewChange={setSelectedView}
          isolatedCount={graph.lints.isolated.length}
          missingTargetCount={graph.lints.missingTarget.length}
          onLintCycle={cycleLint}
          cubeCount={graph.nodes.length}
          joinCount={joinCount}
          viewCount={views.length}
          presentClusters={presentClusters}
        />
      )}

      <Body>
        {isEmpty && <StatusLine $kind="info">No cubes in this game's model yet.</StatusLine>}
        {!loading && !error && !isEmpty && (
          <CubeGraphBoard
            // Remount on game/workspace switch so fitView re-runs on the new graph.
            key={`${workspaceId ?? ''}:${gameId ?? ''}`}
            graph={graph}
            layout={layout}
            selected={selected}
            dimmed={dimmed}
            onSelect={setSelected}
          />
        )}
        {selectedCube && (
          <DetailPanel
            cube={selectedCube}
            cluster={selectedCluster}
            onClose={() => setSelected(null)}
          />
        )}
      </Body>
    </>
  );
}

export default CubeGraphPage;
