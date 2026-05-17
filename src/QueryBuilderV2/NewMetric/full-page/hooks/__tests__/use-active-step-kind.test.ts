import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useActiveStep, stepGraphFor } from '../use-active-step';
import type { NewMetricDraftV3 } from '../../../types';
import { emptyTree, makeLeaf, addLeaf } from '../../../filter-tree';

function makeDraft(overrides: Partial<NewMetricDraftV3> = {}): NewMetricDraftV3 {
  return {
    sourceCubes: [],
    sourceCube: null,
    operation: 'sum',
    inputs: {},
    ofMember: null,
    ofMemberB: null,
    filter: null,
    name: '',
    title: '',
    description: '',
    format: 'number',
    tags: [],
    previewTimeDimension: null,
    previewRange: '7d',
    filterTree: emptyTree(),
    grain: 'daily',
    visibility: 'team',
    artifactKind: 'measure',
    ...overrides,
  };
}

describe('stepGraphFor — per-kind step graph', () => {
  it('measure has 7 steps including step-0 kind picker', () => {
    const graph = stepGraphFor('measure');
    expect(graph.map((s) => s.id)).toEqual([
      'kind',
      'source',
      'op',
      'column',
      'filters',
      'identity',
      'test-run',
    ]);
  });

  it('dimension has 6 steps (no op/column)', () => {
    const graph = stepGraphFor('dimension');
    expect(graph.map((s) => s.id)).toEqual([
      'kind',
      'source',
      'dim-kind',
      'builder',
      'identity',
      'test-run',
    ]);
  });

  it('segment has 5 steps (no op/column/dim)', () => {
    const graph = stepGraphFor('segment');
    expect(graph.map((s) => s.id)).toEqual([
      'kind',
      'source',
      'filter-tree',
      'identity',
      'test-run',
    ]);
  });
});

describe('useActiveStep — kind routing', () => {
  it('measure: totalSteps = 7, default step is 0 on empty draft', () => {
    const { result } = renderHook(() => useActiveStep(makeDraft()));
    expect(result.current.totalSteps).toBe(7);
  });

  it('dimension: totalSteps = 6', () => {
    const { result } = renderHook(() =>
      useActiveStep(makeDraft({ artifactKind: 'dimension' }))
    );
    expect(result.current.totalSteps).toBe(6);
  });

  it('segment: totalSteps = 5', () => {
    const { result } = renderHook(() =>
      useActiveStep(makeDraft({ artifactKind: 'segment' }))
    );
    expect(result.current.totalSteps).toBe(5);
  });

  it('next() clamps to last step (no overflow)', () => {
    const draft = makeDraft({
      artifactKind: 'segment',
      sourceCubes: ['mf_users'],
      name: 'cohort_vn',
      title: 'Cohort VN',
    });
    const { result } = renderHook(() => useActiveStep(draft));
    // segment has indices 0..4 (5 steps)
    act(() => result.current.setStep(4 as any));
    expect(result.current.step).toBe(4);
    act(() => result.current.next());
    expect(result.current.step).toBe(4);
  });

  it('setStep beyond totalSteps clamps to last valid index', () => {
    const draft = makeDraft({
      artifactKind: 'dimension',
      sourceCubes: ['mf_users'],
      name: 'tier',
      title: 'Tier',
    });
    const { result } = renderHook(() => useActiveStep(draft));
    // dimension has indices 0..5 (6 steps). Setting 9 should clamp to 5.
    act(() => result.current.setStep(9 as any));
    expect(result.current.step).toBeLessThanOrEqual(5);
  });

  it('back() clamps to step 0 (no underflow)', () => {
    const { result } = renderHook(() => useActiveStep(makeDraft()));
    act(() => result.current.back());
    expect(result.current.step).toBe(0);
  });

  it('canGoTo(0) is always true (kind picker is reachable)', () => {
    const { result } = renderHook(() => useActiveStep(makeDraft()));
    expect(result.current.canGoTo(0 as any)).toBe(true);
  });

  it('canGoTo blocks skipping ahead past empty source on measure', () => {
    const { result } = renderHook(() => useActiveStep(makeDraft()));
    // step 1 = source, step 2 = op — without source, can't reach op
    expect(result.current.canGoTo(2 as any)).toBe(false);
  });

  it('canGoTo blocks skipping ahead past empty source on dimension', () => {
    const { result } = renderHook(() =>
      useActiveStep(makeDraft({ artifactKind: 'dimension' }))
    );
    // step 2 = dim-kind — needs source first
    expect(result.current.canGoTo(2 as any)).toBe(false);
  });

  it('canGoTo blocks skipping ahead past empty source on segment', () => {
    const { result } = renderHook(() =>
      useActiveStep(makeDraft({ artifactKind: 'segment' }))
    );
    // step 2 = filter-tree — needs source first
    expect(result.current.canGoTo(2 as any)).toBe(false);
  });

  it('doneFlags reflects per-kind doneness (segment with filter-tree)', () => {
    let tree = emptyTree();
    tree = addLeaf(tree, tree.id, makeLeaf('country', 'string', '=', ['VN']));
    const { result } = renderHook(() =>
      useActiveStep(
        makeDraft({
          artifactKind: 'segment',
          sourceCubes: ['mf_users'],
          filterTree: tree,
          name: 'cohort_vn',
          title: 'Cohort VN',
        })
      )
    );
    // step indices: 0=kind, 1=source, 2=filter-tree, 3=identity, 4=test-run
    expect(result.current.doneFlags[0]).toBe(true); // kind is set
    expect(result.current.doneFlags[1]).toBe(true); // source picked
    expect(result.current.doneFlags[2]).toBe(true); // filter tree has leaf
    expect(result.current.doneFlags[3]).toBe(true); // identity filled
  });
});
