/**
 * Tests for Phase-5 cross-layer additions:
 *   - parseFocusRef / extractDataModelFqn (focus URL parsing + back-compat)
 *   - ConceptRelationsSection: renders metric/term/segment chips with trust
 *     badges; degrades gracefully when relations are empty or on error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

import { parseFocusRef, extractDataModelFqn, isBareDataModelRef } from '../cartographer-page';
import { ConceptRelationsSection } from '../concept-relations-section';
import { _resetConceptResolutionCache } from '../../../../components/concept-hover-card/use-concept-resolution';

// ── Focus ref parsing ────────────────────────────────────────────────────────

describe('parseFocusRef', () => {
  it('passes namespaced data_model ref through unchanged', () => {
    expect(parseFocusRef('data_model/mf_users.dau')).toBe('data_model/mf_users.dau');
  });

  it('passes business_metrics ref through unchanged', () => {
    expect(parseFocusRef('business_metrics/dau')).toBe('business_metrics/dau');
  });

  it('passes segments ref through unchanged', () => {
    expect(parseFocusRef('segments/abc123')).toBe('segments/abc123');
  });

  it('normalises bare cube.member (back-compat)', () => {
    expect(parseFocusRef('mf_users.dau')).toBe('mf_users.dau');
  });

  it('strips doubled prefix in bare ref (legacy bookmarks)', () => {
    // normaliseFqn strips "cube.cube.member" → "cube.member"
    expect(parseFocusRef('mf_users.mf_users.dau')).toBe('mf_users.dau');
  });
});

describe('isBareDataModelRef', () => {
  it('returns true for bare cube.member', () => {
    expect(isBareDataModelRef('mf_users.dau')).toBe(true);
  });

  it('returns false for namespaced ref', () => {
    expect(isBareDataModelRef('data_model/mf_users.dau')).toBe(false);
    expect(isBareDataModelRef('business_metrics/dau')).toBe(false);
  });
});

describe('extractDataModelFqn', () => {
  it('extracts FQN from data_model/ ref', () => {
    expect(extractDataModelFqn('data_model/mf_users.dau')).toBe('mf_users.dau');
  });

  it('returns bare ref unchanged (bare is already a cube.member FQN)', () => {
    expect(extractDataModelFqn('mf_users.dau')).toBe('mf_users.dau');
  });

  it('returns null for non-data_model namespaced refs', () => {
    expect(extractDataModelFqn('business_metrics/dau')).toBeNull();
    expect(extractDataModelFqn('segments/abc')).toBeNull();
  });
});

// ── ConceptRelationsSection rendering ────────────────────────────────────────

// Mock the concepts-client so tests don't hit the network.
vi.mock('../../../../api/concepts-client', () => ({
  getConceptRelations: vi.fn(),
}));

import { getConceptRelations } from '../../../../api/concepts-client';

const mockGet = getConceptRelations as ReturnType<typeof vi.fn>;

const FULL_RELATIONS = {
  ref: 'data_model/mf_users.dau',
  fields: [],
  metrics: [
    { ref: 'business_metrics/dau', id: 'dau', label: 'Daily Active Users', trust: 'certified' as const },
    { ref: 'business_metrics/wau', id: 'wau', label: 'Weekly Active Users', trust: 'draft' as const },
  ],
  terms: [
    { ref: 'glossary/active_user', id: 'active_user', label: 'Active User', trust: 'certified' as const },
  ],
  segments: [
    { ref: 'segments/whales', id: 'whales', name: 'Whales' },
  ],
};

const EMPTY_RELATIONS = {
  ref: 'data_model/mf_users.dau',
  fields: [],
  metrics: [],
  terms: [],
  segments: [],
};

function renderSection(
  ref: string,
  layers: Set<string>,
) {
  // LayerFilter set — cast via unknown so we don't import the type in tests.
  const visibleLayers = layers as unknown as ReadonlySet<import('../layer-filter-pills').LayerFilter>;
  return render(
    <MemoryRouter>
      <ConceptRelationsSection conceptRef={ref} visibleLayers={visibleLayers} />
    </MemoryRouter>,
  );
}

describe('ConceptRelationsSection', () => {
  beforeEach(() => {
    _resetConceptResolutionCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetConceptResolutionCache();
  });

  it('renders metric chips with trust badges when metrics layer is on', async () => {
    mockGet.mockResolvedValue(FULL_RELATIONS);
    renderSection('data_model/mf_users.dau', new Set(['metrics', 'glossary', 'segments']));

    await waitFor(() => {
      expect(screen.getByText('Daily Active Users')).toBeTruthy();
      expect(screen.getByText('Weekly Active Users')).toBeTruthy();
    });

    // Multiple chips can share the same trust title — use getAllByTitle.
    expect(screen.getAllByTitle('certified').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTitle('draft').length).toBeGreaterThanOrEqual(1);
  });

  it('renders glossary term chips when glossary layer is on', async () => {
    mockGet.mockResolvedValue(FULL_RELATIONS);
    renderSection('data_model/mf_users.dau', new Set(['metrics', 'glossary', 'segments']));

    await waitFor(() => {
      expect(screen.getByText('Active User')).toBeTruthy();
    });
  });

  it('renders segment chips when segments layer is on', async () => {
    mockGet.mockResolvedValue(FULL_RELATIONS);
    renderSection('data_model/mf_users.dau', new Set(['metrics', 'glossary', 'segments']));

    await waitFor(() => {
      expect(screen.getByText('Whales')).toBeTruthy();
    });
  });

  it('hides metrics section when metrics layer is off', async () => {
    mockGet.mockResolvedValue(FULL_RELATIONS);
    // Only segments layer active.
    renderSection('data_model/mf_users.dau', new Set(['segments']));

    await waitFor(() => {
      expect(screen.getByText('Whales')).toBeTruthy();
    });

    expect(screen.queryByText('Daily Active Users')).toBeNull();
    expect(screen.queryByText('Active User')).toBeNull();
  });

  it('shows empty states when relations exist but sections have no data', async () => {
    mockGet.mockResolvedValue(EMPTY_RELATIONS);
    renderSection('data_model/mf_users.dau', new Set(['metrics', 'glossary', 'segments']));

    await waitFor(() => {
      expect(screen.getByText(/No metrics reference this field/i)).toBeTruthy();
      expect(screen.getByText(/No glossary terms define this field/i)).toBeTruthy();
      expect(screen.getByText(/No segments filter on this field/i)).toBeTruthy();
    });
  });

  it('degrades gracefully on fetch error — renders nothing', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const { container } = renderSection(
      'data_model/mf_users.dau',
      new Set(['metrics', 'glossary', 'segments']),
    );

    await waitFor(() => {
      // After the error settles, no error UI leaked.
      expect(screen.queryByText(/No metrics/i)).toBeNull();
    });

    // Container should be essentially empty (null render from the component).
    expect(container.firstChild).toBeNull();
  });

  it('renders no reverse-edge sections when only fields layer is active', async () => {
    mockGet.mockResolvedValue(FULL_RELATIONS);
    // Only 'fields' layer on — no reverse-edge sections should appear.
    renderSection('data_model/mf_users.dau', new Set(['fields']));

    // Wait for fetch to settle (avoids act() warnings), then confirm no
    // section headers appeared — the layer guard suppresses all sections.
    await waitFor(() => {
      expect(screen.queryByText('Used by metrics')).toBeNull();
    });
    expect(screen.queryByText('Defined as terms')).toBeNull();
    expect(screen.queryByText('Segments filtering this')).toBeNull();
  });

  it('metric chip links to the metric detail route', async () => {
    mockGet.mockResolvedValue(FULL_RELATIONS);
    renderSection('data_model/mf_users.dau', new Set(['metrics']));

    await waitFor(() => {
      const link = screen.getByText('Daily Active Users').closest('a');
      expect(link?.getAttribute('href')).toBe('/catalog/metric/dau');
    });
  });

  it('segment chip links to the segment detail route', async () => {
    mockGet.mockResolvedValue(FULL_RELATIONS);
    renderSection('data_model/mf_users.dau', new Set(['segments']));

    await waitFor(() => {
      const link = screen.getByText('Whales').closest('a');
      expect(link?.getAttribute('href')).toBe('/segments/whales');
    });
  });
});
