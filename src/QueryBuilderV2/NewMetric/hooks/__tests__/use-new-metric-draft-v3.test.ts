import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNewMetricDraft } from '../use-new-metric-draft';
import { makeLeaf, addLeaf } from '../../filter-tree';

const KEY_PREFIX = 'gds-cube:new-metric-draft-v2';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('useNewMetricDraft v3 — artifactKind discriminator', () => {
  it('default artifactKind is "measure" (back-compat)', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    expect(result.current.draft.artifactKind).toBe('measure');
  });

  it('setArtifactKind("dimension") clears measure sub-state (operation, inputs)', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => {
      result.current.setField('sourceCubes', ['mf_users']);
      result.current.setField('operation', 'avg');
      result.current.setInput('value', 'mf_users.ltv_vnd');
    });
    expect(result.current.draft.operation).toBe('avg');

    act(() => {
      result.current.setArtifactKind('dimension');
    });
    expect(result.current.draft.artifactKind).toBe('dimension');
    expect(result.current.draft.operation).toBe('sum'); // default
    expect(result.current.draft.inputs).toEqual({});
  });

  it('setArtifactKind("segment") clears measure sub-state and dim sub-state', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => {
      result.current.setArtifactKind('dimension');
      result.current.setField('dimKind' as any, 'banding' as any);
      result.current.setField('dimBuilder' as any, {
        kind: 'banding',
        column: 'ltv_vnd',
        bands: [],
        elseLabel: 'non_payer',
      } as any);
    });
    expect(result.current.draft.dimKind).toBe('banding');

    act(() => {
      result.current.setArtifactKind('segment');
    });
    expect(result.current.draft.artifactKind).toBe('segment');
    expect(result.current.draft.dimKind).toBeUndefined();
    expect(result.current.draft.dimBuilder).toBeUndefined();
  });

  it('setArtifactKind("measure") clears dim sub-state when switching from dimension', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => {
      result.current.setArtifactKind('dimension');
      result.current.setField('dimKind' as any, 'time-since' as any);
    });
    expect(result.current.draft.dimKind).toBe('time-since');

    act(() => {
      result.current.setArtifactKind('measure');
    });
    expect(result.current.draft.artifactKind).toBe('measure');
    expect(result.current.draft.dimKind).toBeUndefined();
    expect(result.current.draft.dimBuilder).toBeUndefined();
  });

  it('setArtifactKind away from segment with non-empty filterTree clears filterTree', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => {
      result.current.setArtifactKind('segment');
      const leaf = makeLeaf('country', 'string', '=', ['VN']);
      const root = result.current.draft.filterTree;
      result.current.setField('filterTree', addLeaf(root, root.id, leaf));
    });
    expect(result.current.draft.filterTree.children.length).toBe(1);

    act(() => {
      result.current.setArtifactKind('measure');
    });
    expect(result.current.draft.filterTree.children).toEqual([]);
  });

  it('setArtifactKind from measure to dimension preserves filterTree (only segment→other clears it)', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => {
      const leaf = makeLeaf('country', 'string', '=', ['VN']);
      const root = result.current.draft.filterTree;
      result.current.setField('filterTree', addLeaf(root, root.id, leaf));
    });
    expect(result.current.draft.filterTree.children.length).toBe(1);

    act(() => {
      result.current.setArtifactKind('dimension');
    });
    expect(result.current.draft.filterTree.children.length).toBe(1);
  });

  it('switching kind preserves shared identity fields (name, title, sourceCubes)', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => {
      result.current.setField('sourceCubes', ['mf_users']);
      result.current.setField('name', 'my_thing');
      result.current.setField('title', 'My Thing');
      result.current.setField('tags', ['cohort']);
    });

    act(() => {
      result.current.setArtifactKind('segment');
    });
    expect(result.current.draft.sourceCubes).toEqual(['mf_users']);
    expect(result.current.draft.name).toBe('my_thing');
    expect(result.current.draft.title).toBe('My Thing');
    expect(result.current.draft.tags).toEqual(['cohort']);

    act(() => {
      result.current.setArtifactKind('dimension');
    });
    expect(result.current.draft.sourceCubes).toEqual(['mf_users']);
    expect(result.current.draft.name).toBe('my_thing');
  });
});

describe('useNewMetricDraft v3 — V2→V3 localStorage migration', () => {
  function getTabId(): string {
    return window.sessionStorage.getItem('gds-cube:new-metric-tab-id') ?? '';
  }

  it('seeds artifactKind="measure" when hydrating a persisted V2 draft', async () => {
    // Mount once so the tabId is created.
    const probe = renderHook(() => useNewMetricDraft());
    const tabId = getTabId();
    probe.unmount();

    // Now seed a V2-shaped blob keyed to that tabId.
    const v2Draft = {
      sourceCubes: ['mf_users'],
      sourceCube: 'mf_users',
      operation: 'sum',
      inputs: { value: 'mf_users.ltv_vnd' },
      ofMember: 'mf_users.ltv_vnd',
      ofMemberB: null,
      filter: null,
      name: 'sum_ltv_vnd',
      title: 'Sum of ltv vnd',
      description: '',
      format: 'number',
      tags: [],
      previewTimeDimension: null,
      previewRange: '7d',
      filterTree: { kind: 'group', id: 'g1', op: 'AND', children: [] },
      grain: 'daily',
      visibility: 'team',
    };
    window.localStorage.setItem(
      `${KEY_PREFIX}:${tabId}`,
      JSON.stringify({ version: 2, draft: v2Draft })
    );

    const { result } = renderHook(() => useNewMetricDraft());
    await new Promise((r) => setTimeout(r, 30));

    expect(result.current.draft.artifactKind).toBe('measure');
    expect(result.current.draft.sourceCubes).toEqual(['mf_users']);
    expect(result.current.draft.name).toBe('sum_ltv_vnd');
    expect(result.current.draft.title).toBe('Sum of ltv vnd');
    // No leaked dim/segment fields.
    expect(result.current.draft.dimKind).toBeUndefined();
    expect(result.current.draft.dimBuilder).toBeUndefined();
  });

  it('hydrates a V3 draft as-is', async () => {
    const probe = renderHook(() => useNewMetricDraft());
    const tabId = getTabId();
    probe.unmount();

    const v3Draft = {
      sourceCubes: ['mf_users'],
      sourceCube: 'mf_users',
      operation: 'sum',
      inputs: {},
      ofMember: null,
      ofMemberB: null,
      filter: null,
      name: 'whales',
      title: '',
      description: '',
      format: 'number',
      tags: [],
      previewTimeDimension: null,
      previewRange: '7d',
      filterTree: { kind: 'group', id: 'g1', op: 'AND', children: [] },
      grain: 'daily',
      visibility: 'team',
      artifactKind: 'segment',
    };
    window.localStorage.setItem(
      `${KEY_PREFIX}:${tabId}`,
      JSON.stringify({ version: 3, draft: v3Draft })
    );

    const { result } = renderHook(() => useNewMetricDraft());
    await new Promise((r) => setTimeout(r, 30));

    expect(result.current.draft.artifactKind).toBe('segment');
    expect(result.current.draft.name).toBe('whales');
  });
});
