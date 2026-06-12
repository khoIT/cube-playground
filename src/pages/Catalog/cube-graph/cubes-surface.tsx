/**
 * CubesSurface — host for the Cubes tab at the bare /catalog/data-model URL.
 * Renders a Graph | Grid segmented toggle; Graph (the join topology) is the
 * default, `?view=grid` selects the existing card grid. The view is derived
 * from the URL on every render (not one-shot state) so KeepAliveRoute
 * back-navigation never shows a stale view; toggling uses history.replace to
 * avoid history spam, preserving any other query params.
 */
import { lazy, Suspense } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import styled from 'styled-components';

import { CatalogBrowseBody } from '../catalog-browse-body';
import type { CatalogCube } from '../use-catalog-meta';

// Code-split the graph view: reactflow loads only when the graph renders.
const CubeGraphPage = lazy(() => import('./cube-graph-page'));

const ToggleRow = styled.div`
  display: flex;
  align-items: center;
  padding: 12px 32px 0;
`;

const Segmented = styled.div`
  display: inline-flex;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-card);
`;

const SegmentButton = styled.button<{ $active: boolean }>`
  appearance: none;
  border: none;
  cursor: pointer;
  padding: 5px 14px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  background: ${(p) => (p.$active ? 'var(--brand)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--text-on-brand)' : 'var(--text-secondary)')};

  &:hover {
    background: ${(p) => (p.$active ? 'var(--brand-hover)' : 'var(--bg-muted)')};
  }
`;

const StatusLine = styled.div`
  padding: 16px 32px;
  font-size: 13px;
  font-family: var(--font-sans);
  color: var(--text-muted);
`;

type CubesView = 'graph' | 'grid';

interface CubesSurfaceProps {
  cubes: CatalogCube[];
  loading: boolean;
  error: string | null;
}

export function CubesSurface({ cubes, loading, error }: CubesSurfaceProps) {
  const history = useHistory();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const view: CubesView = params.get('view') === 'grid' ? 'grid' : 'graph';

  function setView(next: CubesView) {
    if (next === view) return;
    const nextParams = new URLSearchParams(location.search);
    if (next === 'grid') nextParams.set('view', 'grid');
    else nextParams.delete('view');
    const search = nextParams.toString();
    history.replace(`${location.pathname}${search ? `?${search}` : ''}`);
  }

  return (
    <>
      <ToggleRow>
        <Segmented role="group" aria-label="Cubes view">
          <SegmentButton
            type="button"
            $active={view === 'graph'}
            aria-pressed={view === 'graph'}
            onClick={() => setView('graph')}
          >
            Graph
          </SegmentButton>
          <SegmentButton
            type="button"
            $active={view === 'grid'}
            aria-pressed={view === 'grid'}
            onClick={() => setView('grid')}
          >
            Grid
          </SegmentButton>
        </Segmented>
      </ToggleRow>

      {view === 'grid' ? (
        <CatalogBrowseBody cubes={cubes} loading={loading} error={error} />
      ) : (
        <Suspense fallback={<StatusLine>Loading…</StatusLine>}>
          <CubeGraphPage cubes={cubes} loading={loading} error={error} />
        </Suspense>
      )}
    </>
  );
}
