import { describe, it, expect } from 'vitest';
import { generateV2, GenerateContext } from '../generate-measure-yaml';
import { NewMetricDraftV2 } from '../../types';
import { ReachableMember } from '../../hooks/use-reachable-members';
import { emptyTree, makeLeaf, makeGroup, addLeaf } from '../../filter-tree';

function member(
  cubeName: string,
  shortName: string,
  kind: 'dimension' | 'measure' = 'measure'
): ReachableMember {
  return {
    cubeName,
    shortName,
    memberName: `${cubeName}.${shortName}`,
    kind,
    viaJoin: undefined,
  };
}

const MEMBERS: ReachableMember[] = [
  member('mf_users', 'ltv_30d', 'measure'),
  member('mf_users', 'tier', 'dimension'),
  member('mf_users', 'country', 'dimension'),
];

const FIXED_TS = '2026-05-17T15:00:00.000Z';

function ctx(): GenerateContext {
  return {
    sourceCube: 'mf_users',
    reachableMembers: MEMBERS,
    peerMeasureNames: ['count'],
    createdAt: FIXED_TS,
    author: 'khoitn',
  };
}

function baseDraft(): NewMetricDraftV2 {
  return {
    sourceCube: 'mf_users',
    operation: 'sum',
    ofMember: 'mf_users.ltv_30d',
    ofMemberB: null,
    filter: null,
    name: 'total_ltv',
    title: 'Total LTV',
    description: '',
    format: 'currency-vnd',
    tags: ['revenue'],
    previewTimeDimension: null,
    previewRange: '7d',
    filterTree: emptyTree(),
    grain: 'daily',
    visibility: 'team',
  };
}

describe('generateV2', () => {
  it('emits name, type, sql, format, tags, meta.grain, meta.visibility', () => {
    const { fragment } = generateV2(baseDraft(), ctx());
    expect(fragment).toContain('name: total_ltv');
    expect(fragment).toContain('type: sum');
    expect(fragment).toContain('{mf_users}.ltv_30d');
    expect(fragment).toContain('format: currency-vnd');
    expect(fragment).toMatch(/grain:\s*daily/);
    expect(fragment).toMatch(/visibility:\s*team/);
    expect(fragment).toContain('tags:');
    expect(fragment).toContain('revenue');
  });

  it('does NOT emit a filters key when filterTree is empty', () => {
    const { fragment } = generateV2(baseDraft(), ctx());
    expect(fragment).not.toContain('filters:');
  });

  it('emits a single AND filter as one sql fragment', () => {
    const d = baseDraft();
    d.filterTree = makeGroup('AND', [
      makeLeaf('mf_users.tier', 'string', '=', ['premium']),
      makeLeaf('mf_users.country', 'string', '=', ['VN']),
    ]);
    const { fragment } = generateV2(d, ctx());
    expect(fragment).toContain('filters:');
    expect(fragment).toContain("({mf_users}.tier = 'premium') AND ({mf_users}.country = 'VN')");
  });

  it('emits a nested AND/OR as one parenthesised sql fragment', () => {
    const d = baseDraft();
    const orGroup = makeGroup('OR', [
      makeLeaf('mf_users.country', 'string', '=', ['VN']),
      makeLeaf('mf_users.country', 'string', '=', ['TH']),
    ]);
    d.filterTree = makeGroup('AND', [
      makeLeaf('mf_users.tier', 'string', '=', ['premium']),
      orGroup,
    ]);
    const { fragment } = generateV2(d, ctx());
    expect(fragment).toContain('filters:');
    expect(fragment).toContain("({mf_users}.tier = 'premium')");
    expect(fragment).toContain("({mf_users}.country = 'VN') OR ({mf_users}.country = 'TH')");
  });

  it('median emits PERCENTILE_CONT(0.5) sql', () => {
    const d = baseDraft();
    d.operation = 'median';
    d.name = 'median_ltv';
    const { fragment } = generateV2(d, ctx());
    expect(fragment).toContain('type: number');
    expect(fragment).toContain('PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY {mf_users}.ltv_30d)');
  });

  it('percentile emits PERCENTILE_CONT(0.95) sql', () => {
    const d = baseDraft();
    d.operation = 'percentile';
    d.name = 'p95_ltv';
    const { fragment } = generateV2(d, ctx());
    expect(fragment).toContain('type: number');
    expect(fragment).toContain('PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY {mf_users}.ltv_30d)');
  });

  it('emits meta.created_at, meta.author, meta.source = wizard', () => {
    const { fragment } = generateV2(baseDraft(), ctx());
    expect(fragment).toContain('source: wizard');
    expect(fragment).toContain('author: khoitn');
    expect(fragment).toContain('created_at:');
  });

  it('omits filters key when only an empty inner group exists', () => {
    const d = baseDraft();
    d.filterTree = makeGroup('AND', [makeGroup('OR', [])]);
    const { fragment } = generateV2(d, ctx());
    expect(fragment).not.toContain('filters:');
  });
});
