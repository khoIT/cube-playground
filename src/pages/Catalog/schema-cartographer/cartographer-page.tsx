/**
 * Schema Cartographer page — default tab at `/catalog/data-model`.
 *
 * Read-only browse + search over `useCatalogMeta`. Deep link with
 * `?focus=cube.member` (bare, back-compat) OR `?focus=<namespace>/<id>`
 * (namespaced ref: data_model/, business_metrics/, segments/) selects the
 * matching node. The legacy `/catalog/schema` URL redirects here.
 *
 * Layer filter pills (Fields / Metrics / Glossary / Segments) gate the cube
 * tree visibility and which reverse-edge sections show in the detail panel.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { useCatalogMeta } from '../use-catalog-meta';
import { normaliseFqn } from '../data-model-tab/use-concepts';
import { CartographerSearch } from './cartographer-search';
import { CubeTree } from './cube-tree';
import { MemberDetailPanel } from './member-detail-panel';
import { LayerFilterPills, ALL_LAYERS, type LayerFilter } from './layer-filter-pills';
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

/**
 * Parses a raw `?focus=` value into a canonical focus ref.
 *
 * Accepts two shapes:
 *   - Namespaced ref: "<namespace>/<id>" — returned as-is (no normalisation).
 *     Supported namespaces: data_model, business_metrics, segments.
 *   - Bare cube member: "cube.member" — normalised via normaliseFqn for
 *     back-compat (strips doubled prefixes like "mf_users.mf_users.dau").
 *     Treated as "data_model/cube.member" internally for relation lookups but
 *     the stored focus value stays bare so existing field-chip deep-links work.
 */
export function parseFocusRef(raw: string): string {
  if (raw.includes('/')) {
    // Already namespaced — pass through unchanged.
    return raw;
  }
  // Bare cube.member — normalise only (strip duplicate prefix).
  return normaliseFqn(raw);
}

/**
 * Returns true when the focus ref is a bare cube.member (no namespace prefix).
 * Used to decide whether to look up the member in the cartographer index.
 */
export function isBareDataModelRef(ref: string): boolean {
  return !ref.includes('/');
}

/**
 * Extracts the bare cube.member FQN from a data_model/ namespaced ref.
 * Returns null for other namespace prefixes.
 */
export function extractDataModelFqn(ref: string): string | null {
  if (ref.startsWith('data_model/')) return ref.slice('data_model/'.length);
  if (!ref.includes('/')) return normaliseFqn(ref);
  return null;
}

function useFocusFromQuery(): [string | null, (next: string | null) => void] {
  const history = useHistory();
  const location = useLocation();
  const value = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const raw = params.get('focus');
    return raw ? parseFocusRef(raw) : null;
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

  // Layer filter state — all layers on by default.
  const [activeLayers, setActiveLayers] = useState<Set<LayerFilter>>(
    () => new Set(ALL_LAYERS),
  );

  // Derive the cube.member FQN from the current focus (handles both bare and
  // data_model/ namespaced refs; returns null for other namespace types).
  const focusFqn = focus ? extractDataModelFqn(focus) : null;

  const visibleFqns = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return undefined;
    const hits = searchMembers(index, trimmed, 500);
    return new Set(hits.map((m) => m.fqn));
  }, [index, query]);

  // Resolve the selected member from the cartographer index (works for bare
  // and data_model/ refs; non-data_model refs resolve to null, which is fine
  // — the detail panel would need a different render path, not yet needed).
  const selected = focusFqn ? (index.byFqn.get(focusFqn) ?? null) : null;

  // When the user enters a search that excludes the current selection, clear
  // the focus to avoid showing a detail panel for a hidden member.
  useEffect(() => {
    if (!focusFqn || !visibleFqns) return;
    if (!visibleFqns.has(focusFqn)) setFocus(null);
  }, [focusFqn, visibleFqns, setFocus]);

  const joinable = useMemo(() => {
    if (!selected) return [];
    const cube = index.cubes.find((c) => c.name === selected.cubeName);
    return (cube?.joins ?? []).map((j) => j.name).filter(Boolean);
  }, [index, selected]);

  const showTree = activeLayers.has('fields');

  return (
    <Page>
      <Header>
        <Title>Schema Cartographer</Title>
        <Subtitle>
          Browseable map of cubes, dimensions, measures, and segments. Chat answers link members
          back here via field chips.
        </Subtitle>
        <CartographerSearch value={query} onChange={setQuery} />
        <LayerFilterPills active={activeLayers} onChange={setActiveLayers} />
      </Header>
      {error && <StatusLine $kind="error">Failed to load meta: {error}</StatusLine>}
      {loading && <StatusLine $kind="info">Loading…</StatusLine>}
      {!loading && !error ? (
        <Body>
          {showTree ? (
            <TreeColumn>
              <CubeTree
                index={index}
                visibleFqns={visibleFqns}
                selectedFqn={selected?.fqn}
                onSelect={(fqn) => setFocus(fqn)}
              />
            </TreeColumn>
          ) : null}
          {selected ? (
            <MemberDetailPanel
              member={selected}
              joinableCubes={joinable}
              visibleLayers={activeLayers}
            />
          ) : null}
        </Body>
      ) : null}
    </Page>
  );
}
