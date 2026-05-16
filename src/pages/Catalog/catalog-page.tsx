import { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useCatalogMeta, CatalogCube } from './use-catalog-meta';
import { useCubeClusters } from './use-cube-clusters';
import { CatalogToolbar } from './catalog-toolbar';
import { CatalogGrid } from './catalog-grid';
import { DetailPanel } from './detail-panel';

const Page = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-app);
`;

const Header = styled.header`
  padding: 24px 32px 12px;
  display: flex;
  align-items: baseline;
  gap: 12px;
`;

const Title = styled.h1`
  font-size: 22px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
`;

const Count = styled.span`
  font-size: 13px;
  color: var(--text-muted);
`;

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

/**
 * Catalog browse view — top-level page mounted at /catalog.
 * Reuses extended /meta directly (no QueryBuilder dependency).
 */
export function CatalogPage() {
  const { cubes, loading, error } = useCatalogMeta();
  const [search, setSearch] = useState('');
  const [hasPreAggOnly, setHasPreAggOnly] = useState(false);
  const [selectedCube, setSelectedCube] = useState<string | null>(null);
  const clusters = useCubeClusters(cubes);

  const filteredClusters = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (c: CatalogCube): boolean => {
      if (q) {
        const hit = (s: string | undefined) =>
          s?.toLowerCase().includes(q) ?? false;
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
    <Page>
      <Header>
        <Title>Catalog</Title>
        <Count>
          {loading ? '…' : `${cubes.length} cubes & views`}
        </Count>
      </Header>

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

        {selected && (
          <DetailPanel cube={selected} onClose={() => setSelectedCube(null)} />
        )}
      </Body>
    </Page>
  );
}
