import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNewMetricDraft } from '../use-new-metric-draft';

const TAB_ID_KEY = 'gds-cube:new-metric-tab-id';
const KEY_PREFIX = 'gds-cube:new-metric-draft-v2';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('useNewMetricDraft v2', () => {
  it('default draft includes filterTree (empty AND group) + grain + visibility', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    expect(result.current.draft.filterTree.kind).toBe('group');
    expect(result.current.draft.filterTree.op).toBe('AND');
    expect(result.current.draft.filterTree.children).toEqual([]);
    expect(result.current.draft.grain).toBe('daily');
    expect(result.current.draft.visibility).toBe('team');
  });

  it('setField updates the new v2 fields', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => {
      result.current.setField('grain', 'weekly');
      result.current.setField('visibility', 'org');
    });
    expect(result.current.draft.grain).toBe('weekly');
    expect(result.current.draft.visibility).toBe('org');
  });

  it('persists tabId in sessionStorage', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    expect(window.sessionStorage.getItem(TAB_ID_KEY)).toBeTruthy();
    expect(result.current.tabId).toMatch(/^tab_/);
  });

  it('writes draft to tab-scoped localStorage key after debounce', async () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => {
      result.current.setField('sourceCube', 'mf_users');
    });
    // Wait for debounce (200ms) + buffer.
    await new Promise((r) => setTimeout(r, 280));
    const tabId = result.current.tabId;
    const stored = window.localStorage.getItem(`${KEY_PREFIX}:${tabId}`);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.version).toBe(2);
    expect(parsed.draft.sourceCube).toBe('mf_users');
  });

  it('clearPersisted removes the localStorage entry', async () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => {
      result.current.setField('sourceCube', 'mf_users');
    });
    await new Promise((r) => setTimeout(r, 280));
    const tabId = result.current.tabId;
    expect(window.localStorage.getItem(`${KEY_PREFIX}:${tabId}`)).toBeTruthy();
    act(() => {
      result.current.clearPersisted();
    });
    expect(window.localStorage.getItem(`${KEY_PREFIX}:${tabId}`)).toBeNull();
  });

  it('hydrates from localStorage on mount', async () => {
    // Seed a stored draft for the tab id we will create.
    // First hook call assigns a tab id; pre-seed using same expected key.
    // We assign a known tabId first.
    const knownTabId = 'tab_test_123';
    window.sessionStorage.setItem(TAB_ID_KEY, knownTabId);
    window.localStorage.setItem(
      `${KEY_PREFIX}:${knownTabId}`,
      JSON.stringify({
        version: 2,
        draft: {
          sourceCube: 'mf_users',
          operation: 'sum',
          ofMember: 'mf_users.ltv_30d',
          ofMemberB: null,
          filter: null,
          name: 'restored_metric',
          title: 'Restored',
          description: '',
          format: 'number',
          tags: [],
          previewTimeDimension: null,
          previewRange: '7d',
          filterTree: { kind: 'group', id: 'g1', op: 'AND', children: [] },
          grain: 'weekly',
          visibility: 'org',
        },
      })
    );
    const { result } = renderHook(() => useNewMetricDraft());
    // useEffect runs after mount — give it a microtask.
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.draft.sourceCube).toBe('mf_users');
    expect(result.current.draft.name).toBe('restored_metric');
    expect(result.current.draft.grain).toBe('weekly');
  });

  it('hydration sanitiser drops out-of-meta ofMember', async () => {
    const knownTabId = 'tab_sanitise';
    window.sessionStorage.setItem(TAB_ID_KEY, knownTabId);
    window.localStorage.setItem(
      `${KEY_PREFIX}:${knownTabId}`,
      JSON.stringify({
        version: 2,
        draft: {
          sourceCube: 'mf_users',
          operation: 'sum',
          ofMember: 'gone_cube.gone_col',
          ofMemberB: null,
          filter: null,
          name: '', title: '', description: '',
          format: 'number', tags: [],
          previewTimeDimension: null, previewRange: '7d',
          filterTree: { kind: 'group', id: 'g1', op: 'AND', children: [] },
          grain: 'daily', visibility: 'team',
        },
      })
    );
    const reachableNames = new Set(['mf_users.ltv_30d']);
    const { result } = renderHook(() => useNewMetricDraft({ reachableNames }));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.draft.ofMember).toBeNull();
  });
});
