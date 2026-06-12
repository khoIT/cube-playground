/**
 * CatalogBrowseBody — the cube card grid with search/facet toolbar and the
 * DetailPanel rail. Extracted from catalog-page.tsx so the Cubes surface can
 * host it as the Grid view next to the join-graph view without an import
 * cycle through the Catalog dispatch.
 */
import { useMemo, useState } from 'react';
import styled from 'styled-components';

import { CatalogGrid } from './catalog-grid';
import { CatalogToolbar } from './catalog-toolbar';
import { DetailPanel } from './detail-panel';
import { CatalogCube } from './use-catalog-meta';
import { useCubeClusters } from './use-cube-clusters';

const Body = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
`;

const Main = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 0 24px 32px;
`;

const StatusLine = styled.div<{ $kind: 'info' | 'error' }>`
  padding: 16px 32px;
  font-size: 13px;
  color: ${(p) => (p.$kind === 'error' ? 'var(--danger)' : 'var(--text-muted)')};
`;

type CatalogBrowseBodyProps = {
  cubes: CatalogCube[];
  loading: boolean;
  error: string | null;
};

export function CatalogBrowseBody({ cubes, loading, error }: CatalogBrowseBodyProps) {
  const [search, setSearch] = useState('');
  const [hasPreAggOnly, setHasPreAggOnly] = useState(false);
  const [selectedCube, setSelectedCube] = useState<string | null>(null);
  const clusters = useCubeClusters(cubes);

  const filteredClusters = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (c: CatalogCube): boolean => {
      if (q) {
        const hit = (s: string | undefined) => s?.toLowerCase().includes(q) ?? false;
        if (!(hit(c.name) || hit(c.title) || hit(c.description))) return false;
      }
      if (hasPreAggOnly && (c.preAggregations?.length ?? 0) === 0) return false;
      return true;
    };
    return {
      connected: clusters.connected
        .map((group) => group.filter(matches))
        .filter((g) => g.length > 0),
      standalone: clusters.standalone.filter(matches),
    };
  }, [clusters, search, hasPreAggOnly]);

  const selected = useMemo(
    () => cubes.find((c) => c.name === selectedCube) ?? null,
    [cubes, selectedCube],
  );

  return (
    <>
      {error && <StatusLine $kind="error">Failed to load meta: {error}</StatusLine>}
      {loading && <StatusLine $kind="info">Loading…</StatusLine>}

      <CatalogToolbar
        search={search}
        onSearchChange={setSearch}
        hasPreAggOnly={hasPreAggOnly}
        onHasPreAggToggle={() => setHasPreAggOnly((v) => !v)}
      />

      <Body>
        <Main>
          {!loading && !error && (
            <CatalogGrid
              clusters={filteredClusters}
              onSelect={(name) => setSelectedCube(name)}
              selected={selectedCube}
            />
          )}
        </Main>

        {selected && <DetailPanel cube={selected} onClose={() => setSelectedCube(null)} />}
      </Body>
    </>
  );
}
