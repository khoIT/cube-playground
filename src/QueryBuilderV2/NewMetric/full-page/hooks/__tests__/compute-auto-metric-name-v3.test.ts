import { describe, it, expect } from 'vitest';
import { computeAutoMetricName, computeAutoMetricTitle } from '../compute-auto-metric-name';
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

describe('computeAutoMetricName — measure kind (regression gate)', () => {
  it('sum + revenue → sum_revenue', () => {
    expect(
      computeAutoMetricName(
        makeDraft({
          sourceCubes: ['orders'],
          operation: 'sum',
          inputs: { value: 'orders.revenue' },
        })
      )
    ).toBe('sum_revenue');
  });

  it('countDistinct + user_id → count_distinct_user_id', () => {
    expect(
      computeAutoMetricName(
        makeDraft({
          sourceCubes: ['mf_users'],
          operation: 'countDistinct',
          inputs: { value: 'mf_users.user_id' },
        })
      )
    ).toBe('count_distinct_user_id');
  });
});

describe('computeAutoMetricName — dimension kind', () => {
  it('banding column → <col>_tier', () => {
    expect(
      computeAutoMetricName(
        makeDraft({
          artifactKind: 'dimension',
          dimKind: 'banding',
          sourceCubes: ['mf_users'],
          dimBuilder: { kind: 'banding', column: 'ltv_vnd', bands: [], elseLabel: '' },
        })
      )
    ).toBe('ltv_vnd_tier');
  });

  it('time-since day + install_date → days_since_install_date', () => {
    expect(
      computeAutoMetricName(
        makeDraft({
          artifactKind: 'dimension',
          dimKind: 'time-since',
          sourceCubes: ['mf_users'],
          dimBuilder: { kind: 'time-since', timeColumn: 'install_date', unit: 'day' },
        })
      )
    ).toBe('days_since_install_date');
  });

  it('time-since hour unit → hours_since_<col>', () => {
    expect(
      computeAutoMetricName(
        makeDraft({
          artifactKind: 'dimension',
          dimKind: 'time-since',
          sourceCubes: ['mf_users'],
          dimBuilder: { kind: 'time-since', timeColumn: 'last_login_at', unit: 'hour' },
        })
      )
    ).toBe('hours_since_last_login_at');
  });

  it('passthrough column → just the column shortname', () => {
    expect(
      computeAutoMetricName(
        makeDraft({
          artifactKind: 'dimension',
          dimKind: 'passthrough',
          sourceCubes: ['mf_users'],
          dimBuilder: {
            kind: 'passthrough',
            column: 'country',
            outputType: 'string',
          },
        })
      )
    ).toBe('country');
  });

  it('boolean predicate → is_<slug>', () => {
    const leaf = makeLeaf('ltv_vnd', 'number', '>', ['0']);
    expect(
      computeAutoMetricName(
        makeDraft({
          artifactKind: 'dimension',
          dimKind: 'boolean',
          sourceCubes: ['mf_users'],
          dimBuilder: { kind: 'boolean', predicate: leaf },
        })
      )
    ).toBe('is_ltv_vnd_gt_0');
  });

  it('boolean slug truncates to ≤32 chars', () => {
    const longCol = 'a_really_really_really_long_column_name_indeed';
    const leaf = makeLeaf(longCol, 'string', '=', ['vn']);
    const name = computeAutoMetricName(
      makeDraft({
        artifactKind: 'dimension',
        dimKind: 'boolean',
        sourceCubes: ['mf_users'],
        dimBuilder: { kind: 'boolean', predicate: leaf },
      })
    );
    expect(name.length).toBeLessThanOrEqual(32);
    expect(name.startsWith('is_')).toBe(true);
  });

  it('falls back to untitled_dimension when no builder yet', () => {
    expect(
      computeAutoMetricName(
        makeDraft({ artifactKind: 'dimension', sourceCubes: ['mf_users'] })
      )
    ).toBe('untitled_dimension');
  });
});

describe('computeAutoMetricName — segment kind', () => {
  it('builds slug from filter-tree leaves (≤24 chars)', () => {
    let tree = emptyTree();
    tree = addLeaf(tree, tree.id, makeLeaf('country', 'string', '=', ['VN']));
    tree = addLeaf(tree, tree.id, makeLeaf('ltv_vnd', 'number', '>=', ['10000000']));

    const name = computeAutoMetricName(
      makeDraft({ artifactKind: 'segment', sourceCubes: ['mf_users'], filterTree: tree })
    );
    expect(name.length).toBeLessThanOrEqual(24);
    expect(name).toMatch(/vn/);
  });

  it('empty filter tree → untitled_segment', () => {
    expect(
      computeAutoMetricName(
        makeDraft({ artifactKind: 'segment', sourceCubes: ['mf_users'] })
      )
    ).toBe('untitled_segment');
  });
});

describe('computeAutoMetricName — collision suffix', () => {
  it('appends _2 when name exists', () => {
    const draft = makeDraft({
      sourceCubes: ['orders'],
      operation: 'sum',
      inputs: { value: 'orders.revenue' },
    });
    const existing = new Set(['sum_revenue']);
    expect(computeAutoMetricName(draft, existing)).toBe('sum_revenue_2');
  });

  it('appends _3 when _2 also exists', () => {
    const draft = makeDraft({
      sourceCubes: ['orders'],
      operation: 'sum',
      inputs: { value: 'orders.revenue' },
    });
    const existing = new Set(['sum_revenue', 'sum_revenue_2']);
    expect(computeAutoMetricName(draft, existing)).toBe('sum_revenue_3');
  });

  it('no suffix when name does not exist', () => {
    const draft = makeDraft({
      sourceCubes: ['orders'],
      operation: 'sum',
      inputs: { value: 'orders.revenue' },
    });
    expect(computeAutoMetricName(draft, new Set())).toBe('sum_revenue');
  });

  it('idempotent — same draft + same existing set → same name', () => {
    const draft = makeDraft({
      sourceCubes: ['orders'],
      operation: 'sum',
      inputs: { value: 'orders.revenue' },
    });
    const existing = new Set(['sum_revenue']);
    expect(computeAutoMetricName(draft, existing)).toBe(
      computeAutoMetricName(draft, existing)
    );
  });
});

describe('computeAutoMetricTitle — kind awareness', () => {
  it('dimension title for banding', () => {
    expect(
      computeAutoMetricTitle(
        makeDraft({
          artifactKind: 'dimension',
          dimKind: 'banding',
          sourceCubes: ['mf_users'],
          dimBuilder: { kind: 'banding', column: 'ltv_vnd', bands: [], elseLabel: '' },
        })
      )
    ).toMatch(/ltv vnd tier/i);
  });

  it('segment title from tree', () => {
    let tree = emptyTree();
    tree = addLeaf(tree, tree.id, makeLeaf('country', 'string', '=', ['VN']));
    expect(
      computeAutoMetricTitle(
        makeDraft({ artifactKind: 'segment', sourceCubes: ['mf_users'], filterTree: tree })
      )
    ).toMatch(/segment/i);
  });
});
