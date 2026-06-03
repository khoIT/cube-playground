/**
 * ConceptMapPage integration tests — the interaction seams a single unit can't
 * cover: ?focus deep-link round-trip across ALL layers (the headline win that
 * closes the Cartographer "no metric rows" gap), click-to-focus URL update,
 * layer-pill column gating, search narrowing, and focus-clears-when-filtered.
 *
 * ConceptBoard is stubbed (it owns the reactflow canvas, which doesn't measure
 * in jsdom). We assert on the props the page feeds the board — focusedRef,
 * node count, active layers, edge count — i.e. the page's own logic.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import ConceptMapPage from '../concept-map-page';
import type { ConceptNode } from '../concept-node';

// ── Mocks ────────────────────────────────────────────────────────────────
const GRAPH_NODES: ConceptNode[] = [
  { kind: 'field', ref: 'data_model/mf_users.dau', label: 'DAU field', sublabel: 'mf_users.dau' },
  { kind: 'metric', ref: 'business_metrics/dau', label: 'DAU metric', trust: 'certified' },
  { kind: 'term', ref: 'glossary/whale', label: 'Whale', trust: 'draft' },
  { kind: 'appSegment', ref: 'segments/s1', label: 'High spenders', trust: 'certified' },
];

vi.mock('../use-concept-graph', () => ({
  useConceptGraph: () => ({
    nodes: GRAPH_NODES,
    byRef: new Map(),
    loading: false,
    error: null,
  }),
}));

// Edges exist whenever a node is focused (1 here is enough to assert presence).
vi.mock('../use-focus-edges', () => ({
  useFocusEdges: (ref: string | null) => ({
    edges: ref ? [{ from: ref, to: 'data_model/mf_users.dau', kind: 'field' }] : [],
    loading: false,
    error: null,
  }),
}));

// Stub the canvas; surface the props the page passes as queryable DOM.
vi.mock('../concept-board', () => ({
  ConceptBoard: (props: {
    graphNodes: ConceptNode[];
    activeLayers: ReadonlySet<string>;
    focusedRef: string | null;
    edges: unknown[];
    onFocus: (ref: string | null) => void;
  }) => (
    <div
      data-testid="board"
      data-focused={props.focusedRef ?? ''}
      data-nodecount={props.graphNodes.length}
      data-edgecount={props.edges.length}
      data-layers={[...props.activeLayers].sort().join(',')}
    >
      <button data-testid="focus-field" onClick={() => props.onFocus('data_model/mf_users.dau')}>
        focus field
      </button>
    </div>
  ),
}));

function renderAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ConceptMapPage />
    </MemoryRouter>,
  );
}

const BASE = '/catalog/data-model/concept-map';

afterEach(() => {
  vi.clearAllMocks();
});

describe('ConceptMapPage', () => {
  it('focuses a metric node from ?focus=business_metrics/... and draws edges (closes the Cartographer gap)', () => {
    renderAt(`${BASE}?focus=business_metrics/dau`);
    const board = screen.getByTestId('board');
    expect(board.getAttribute('data-focused')).toBe('business_metrics/dau');
    expect(Number(board.getAttribute('data-edgecount'))).toBeGreaterThan(0);
  });

  it('focuses a field node on click and reflects it (URL-backed)', async () => {
    renderAt(BASE);
    expect(screen.getByTestId('board').getAttribute('data-focused')).toBe('');
    fireEvent.click(screen.getByTestId('focus-field'));
    await waitFor(() =>
      expect(screen.getByTestId('board').getAttribute('data-focused')).toBe('data_model/mf_users.dau'),
    );
  });

  it('hides a layer column when its pill is toggled off', async () => {
    renderAt(BASE);
    const board = screen.getByTestId('board');
    expect(board.getAttribute('data-layers')).toBe('fields,glossary,metrics,segments');
    fireEvent.click(screen.getByRole('button', { name: 'Fields' }));
    await waitFor(() =>
      expect(screen.getByTestId('board').getAttribute('data-layers')).toBe('glossary,metrics,segments'),
    );
  });

  it('narrows nodes across layers via search', async () => {
    renderAt(BASE);
    expect(screen.getByTestId('board').getAttribute('data-nodecount')).toBe('4');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'whale' } });
    await waitFor(() =>
      expect(screen.getByTestId('board').getAttribute('data-nodecount')).toBe('1'),
    );
  });

  it('clears focus when a search hides the focused node (others still shown)', async () => {
    renderAt(`${BASE}?focus=business_metrics/dau`);
    expect(screen.getByTestId('board').getAttribute('data-focused')).toBe('business_metrics/dau');
    // "whale" keeps the glossary term but drops the focused metric → board
    // still renders, focus must clear so no orphan edges dangle.
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'whale' } });
    await waitFor(() => {
      const board = screen.getByTestId('board');
      expect(board.getAttribute('data-nodecount')).toBe('1');
      expect(board.getAttribute('data-focused')).toBe('');
    });
  });
});
