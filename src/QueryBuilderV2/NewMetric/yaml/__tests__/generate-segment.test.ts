import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { generateSegment } from '../generate-segment';
import type { NewMetricDraftV3 } from '../../types';
import { emptyTree, makeLeaf, addLeaf, makeGroup, addGroup } from '../../filter-tree';

function makeDraft(overrides: Partial<NewMetricDraftV3>): NewMetricDraftV3 {
  return {
    sourceCubes: ['mf_users'],
    sourceCube: 'mf_users',
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
    artifactKind: 'segment',
    ...overrides,
  };
}

const CTX = {
  sourceCube: 'mf_users',
  createdAt: '2026-05-17T22:30:00.000Z',
  author: 'khoitn',
};

describe('generateSegment — single-cube member-reference form (F-2)', () => {
  it('single leaf country=VN → sql uses {country} same-cube member form', () => {
    let tree = emptyTree();
    tree = addLeaf(tree, tree.id, makeLeaf('mf_users.country', 'string', '=', ['VN']));
    const draft = makeDraft({ name: 'vn_users', filterTree: tree });

    const out = generateSegment(draft, CTX);
    expect(out.sectionKey).toBe('segments');
    const parsed = yaml.load(out.fragment) as any;
    expect(parsed.name).toBe('vn_users');
    expect(parsed.sql).toBe("{country} = 'VN'");
  });

  it('two-leaf AND → wraps each leaf in parens and joins with AND', () => {
    let tree = emptyTree();
    tree = addLeaf(tree, tree.id, makeLeaf('mf_users.country', 'string', '=', ['VN']));
    tree = addLeaf(tree, tree.id, makeLeaf('mf_users.ltv_vnd', 'number', '>=', ['10000000']));
    const draft = makeDraft({ name: 'vn_whales', filterTree: tree });

    const parsed = yaml.load(generateSegment(draft, CTX).fragment) as any;
    expect(parsed.sql).toBe("({country} = 'VN') AND ({ltv_vnd} >= 10000000)");
  });

  it('OR group nested inside AND → preserves grouping with parentheses', () => {
    let tree = emptyTree();
    tree = addLeaf(tree, tree.id, makeLeaf('mf_users.country', 'string', '=', ['VN']));
    let orGroup = makeGroup('OR');
    orGroup = addLeaf(orGroup, orGroup.id, makeLeaf('mf_users.ltv_vnd', 'number', '>=', ['10000000']));
    orGroup = addLeaf(orGroup, orGroup.id, makeLeaf('mf_users.txn_count_30d', 'number', '>=', ['5']));
    tree = addGroup(tree, tree.id, orGroup);
    const draft = makeDraft({ name: 'whales_or_active', filterTree: tree });
    const parsed = yaml.load(generateSegment(draft, CTX).fragment) as any;
    expect(parsed.sql).toContain("{country} = 'VN'");
    expect(parsed.sql).toContain('OR');
  });
});

describe('generateSegment — empty + edge cases', () => {
  it('empty filter tree → throws "segment SQL cannot be empty"', () => {
    const draft = makeDraft({ name: 'empty', filterTree: emptyTree() });
    expect(() => generateSegment(draft, CTX)).toThrow(/empty|at least/i);
  });

  it('group with only empty groups → throws (effectively empty)', () => {
    let tree = emptyTree();
    tree = addGroup(tree, tree.id, makeGroup('OR'));
    const draft = makeDraft({ name: 'x', filterTree: tree });
    expect(() => generateSegment(draft, CTX)).toThrow(/empty/i);
  });

  it('escapes single quotes in string values', () => {
    let tree = emptyTree();
    tree = addLeaf(tree, tree.id, makeLeaf('mf_users.name', 'string', '=', ["O'Brien"]));
    const draft = makeDraft({ name: 'obrien', filterTree: tree });
    const parsed = yaml.load(generateSegment(draft, CTX).fragment) as any;
    expect(parsed.sql).toBe("{name} = 'O''Brien'");
  });
});

describe('generateSegment — name + description + meta', () => {
  it('emits description when present', () => {
    let tree = emptyTree();
    tree = addLeaf(tree, tree.id, makeLeaf('mf_users.country', 'string', '=', ['VN']));
    const draft = makeDraft({
      name: 'vn_users',
      description: 'Users in VN',
      filterTree: tree,
    });
    const parsed = yaml.load(generateSegment(draft, CTX).fragment) as any;
    expect(parsed.description).toBe('Users in VN');
  });

  it('emits meta block with source, author, created_at, grain, visibility', () => {
    let tree = emptyTree();
    tree = addLeaf(tree, tree.id, makeLeaf('mf_users.country', 'string', '=', ['VN']));
    const draft = makeDraft({ name: 'vn', filterTree: tree });
    const parsed = yaml.load(generateSegment(draft, CTX).fragment) as any;
    expect(parsed.meta).toMatchObject({
      source: 'wizard',
      author: 'khoitn',
      created_at: '2026-05-17T22:30:00.000Z',
      grain: 'daily',
      visibility: 'team',
    });
  });

  it('preserves outer key order name, sql, [description], meta', () => {
    let tree = emptyTree();
    tree = addLeaf(tree, tree.id, makeLeaf('mf_users.country', 'string', '=', ['VN']));
    const draft = makeDraft({ name: 'vn', description: 'd', filterTree: tree });
    const keys = Object.keys(yaml.load(generateSegment(draft, CTX).fragment) as object);
    expect(keys).toEqual(['name', 'sql', 'description', 'meta']);
  });
});
