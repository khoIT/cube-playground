/**
 * Schema Cartographer page — default tab at `/catalog/data-model`.
 *
 * Read-only browse + search over `useCatalogMeta`. Deep link with
 * `?focus=cube.member` selects the matching member. The legacy
 * `/catalog/schema` URL redirects here, preserving the focus param.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { useCatalogMeta } from '../use-catalog-meta';
import { CartographerSearch } from './cartographer-search';
import { CubeTree } from './cube-tree';
import { MemberDetailPanel } from './member-detail-panel';
import { searchMembers, useCartographerIndex } from './use-cartographer-index';

const Page = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-app);
`;

const Header = styled.div`
  padding: 20px 24px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--text-primary);
  font-family: var(--font-sans);
`;

const Subtitle = styled.p`
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
  font-family: var(--font-sans);
`;

const Body = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
`;

const TreeColumn = styled.div`
  flex: 1;
  min-width: 0;
  padding: 12px 24px 24px;
  overflow-y: auto;
`;

const StatusLine = styled.div<{ $kind: 'info' | 'error' }>`
  padding: 16px 24px;
  font-size: 13px;
  color: ${(p) => (p.$kind === 'error' ? 'var(--danger)' : 'var(--text-muted)')};
`;

function useFocusFromQuery(): [string | null, (next: string | null) => void] {
  const history = useHistory();
  const location = useLocation();
  const value = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('focus');
  }, [location.search]);
  const set = (next: string | null) => {
    const params = new URLSearchParams(location.search);
    if (next) params.set('focus', next);
    else params.delete('focus');
    history.replace({ pathname: location.pathname, search: params.toString() });
  };
  return [value, set];
}

export function SchemaCartographerPage() {
  const { cubes, loading, error } = useCatalogMeta();
  const index = useCartographerIndex(cubes);
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useFocusFromQuery();

  const visibleFqns = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return undefined;
    const hits = searchMembers(index, trimmed, 500);
    return new Set(hits.map((m) => m.fqn));
  }, [index, query]);

  const selected = focus ? index.byFqn.get(focus) ?? null : null;

  // When the user enters a search that excludes the current selection, clear
  // the focus to avoid showing a detail panel for a hidden member.
  useEffect(() => {
    if (!focus || !visibleFqns) return;
    if (!visibleFqns.has(focus)) setFocus(null);
  }, [focus, visibleFqns, setFocus]);

  const joinable = useMemo(() => {
    if (!selected) return [];
    const cube = index.cubes.find((c) => c.name === selected.cubeName);
    return (cube?.joins ?? []).map((j) => j.name).filter(Boolean);
  }, [index, selected]);

  return (
    <Page>
      <Header>
        <Title>Schema Cartographer</Title>
        <Subtitle>
          Browseable map of cubes, dimensions, measures, and segments. Chat answers link members
          back here via field chips.
        </Subtitle>
        <CartographerSearch value={query} onChange={setQuery} />
      </Header>
      {error && <StatusLine $kind="error">Failed to load meta: {error}</StatusLine>}
      {loading && <StatusLine $kind="info">Loading…</StatusLine>}
      {!loading && !error ? (
        <Body>
          <TreeColumn>
            <CubeTree
              index={index}
              visibleFqns={visibleFqns}
              selectedFqn={selected?.fqn}
              onSelect={(fqn) => setFocus(fqn)}
            />
          </TreeColumn>
          {selected ? <MemberDetailPanel member={selected} joinableCubes={joinable} /> : null}
        </Body>
      ) : null}
    </Page>
  );
}
