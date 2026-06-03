/**
 * useConceptGraph tests — node enumeration across all 4 layers, ref grammar,
 * cube-segment vs app-segment disambiguation, byRef lookup, loading/error.
 *
 * The 4 list sources are mocked at the module boundary so the hook is exercised
 * in isolation (no network, no real /meta).
 */

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useConceptGraph } from '../use-concept-graph';
import type { Concept } from '../../data-model-tab/concept-types';
import type { BusinessMetric } from '../../metrics-tab/business-metric-types';
import type { GlossaryTerm } from '../../../../api/glossary-client';
import type { Segment } from '../../../../types/segment-api';

// ── Mocks for the 4 enumeration sources ──────────────────────────────────────
const useConceptsMock = vi.fn();
const useBusinessMetricsMock = vi.fn();
const listGlossaryMock = vi.fn();
const segmentsListMock = vi.fn();

vi.mock('../../data-model-tab/use-concepts', () => ({
  useConcepts: () => useConceptsMock(),
}));
vi.mock('../../metrics-tab/use-business-metrics', () => ({
  useBusinessMetrics: () => useBusinessMetricsMock(),
}));
vi.mock('../../../../api/glossary-client', () => ({
  listGlossary: (...args: unknown[]) => listGlossaryMock(...args),
}));
vi.mock('../../../../api/segments-client', () => ({
  segmentsClient: { list: (...args: unknown[]) => segmentsListMock(...args) },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────
const FIELD_MEASURE = {
  type: 'measure',
  cubeKind: 'cube',
  fqn: 'mf_users.dau',
  cube: 'mf_users',
  name: 'dau',
  title: 'Daily Active Users',
} as Concept;

const FIELD_DIM = {
  type: 'dimension',
  cubeKind: 'cube',
  fqn: 'mf_users.country',
  cube: 'mf_users',
  name: 'country',
  title: 'Country',
} as Concept;

// A Cube-YAML segment — must NOT become an appSegment node.
const CUBE_SEGMENT = {
  type: 'segment',
  cubeKind: 'cube',
  fqn: 'mf_users.payers',
  cube: 'mf_users',
  name: 'payers',
  title: 'Payers',
} as Concept;

const METRIC = {
  id: 'dau',
  label: 'DAU',
  description: '',
  tier: 1,
  domain: 'engagement',
  owner: 'd@v',
  trust: 'certified',
  formula: { type: 'measure', ref: 'mf_users.dau' },
} as BusinessMetric;

const TERM = {
  id: 'active-user',
  label: 'Active User',
  category: 'engagement',
  trust: 'draft',
} as GlossaryTerm;

const APP_SEGMENT = { id: 'whales', name: 'Whales' } as Segment;

function primeAllSources() {
  useConceptsMock.mockReturnValue({
    concepts: [FIELD_MEASURE, FIELD_DIM, CUBE_SEGMENT],
    cubes: [],
    loading: false,
    error: null,
  });
  useBusinessMetricsMock.mockReturnValue({
    metrics: [METRIC],
    loading: false,
    error: null,
    refresh: () => {},
  });
  listGlossaryMock.mockResolvedValue([TERM]);
  segmentsListMock.mockResolvedValue([APP_SEGMENT]);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('useConceptGraph', () => {
  it('enumerates all 4 layers with correct kind + namespaced ref', async () => {
    primeAllSources();
    const { result } = renderHook(() => useConceptGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const byRef = result.current.byRef;
    expect(byRef.get('data_model/mf_users.dau')).toMatchObject({
      kind: 'field',
      label: 'Daily Active Users',
      sublabel: 'mf_users.dau',
    });
    expect(byRef.get('data_model/mf_users.country')?.kind).toBe('field');
    expect(byRef.get('business_metrics/dau')).toMatchObject({
      kind: 'metric',
      trust: 'certified',
    });
    expect(byRef.get('glossary/active-user')).toMatchObject({
      kind: 'term',
      trust: 'draft',
    });
    expect(byRef.get('segments/whales')).toMatchObject({
      kind: 'appSegment',
      label: 'Whales',
      trust: 'certified',
    });
  });

  it('does NOT emit a cube-YAML segment as an appSegment', async () => {
    primeAllSources();
    const { result } = renderHook(() => useConceptGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The cube segment "payers" is excluded entirely (not a field, not an app segment).
    expect(result.current.byRef.has('segments/payers')).toBe(false);
    expect(result.current.byRef.has('data_model/mf_users.payers')).toBe(false);
    const appSegments = result.current.nodes.filter((n) => n.kind === 'appSegment');
    expect(appSegments.map((n) => n.ref)).toEqual(['segments/whales']);
    // Only measures + dimensions become field nodes.
    const fields = result.current.nodes.filter((n) => n.kind === 'field');
    expect(fields).toHaveLength(2);
  });

  it('reports loading until the async list sources settle', async () => {
    primeAllSources();
    const { result } = renderHook(() => useConceptGraph());
    // glossary + segments start async → loading true on first render.
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('surfaces an error from any source', async () => {
    primeAllSources();
    segmentsListMock.mockRejectedValue(new Error('segments boom'));
    const { result } = renderHook(() => useConceptGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('segments boom');
  });
});
