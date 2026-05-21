import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { generateEntry } from '../generate-cube-entry';
import { generateV2 } from '../generate-measure-yaml';
import type { NewMetricDraftV3 } from '../../types';
import { emptyTree, makeLeaf, addLeaf } from '../../filter-tree';

const CTX = {
  sourceCube: 'mf_users',
  reachableMembers: [],
  peerMeasureNames: ['sum_x'],
  createdAt: '2026-05-17T22:30:00.000Z',
  author: 'khoitn',
};

function makeMeasureDraft(): NewMetricDraftV3 {
  return {
    sourceCubes: ['mf_users'],
    sourceCube: 'mf_users',
    operation: 'sum',
    inputs: { value: 'mf_users.ltv_vnd' },
    ofMember: 'mf_users.ltv_vnd',
    ofMemberB: null,
    filter: null,
    name: 'sum_ltv',
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
  };
}

function makeDimDraft(): NewMetricDraftV3 {
  return {
    ...makeMeasureDraft(),
    artifactKind: 'dimension',
    name: 'country',
    dimKind: 'passthrough',
    dimBuilder: { kind: 'passthrough', column: 'country', outputType: 'string' },
  };
}

function makeSegmentDraft(): NewMetricDraftV3 {
  let tree = emptyTree();
  tree = addLeaf(tree, tree.id, makeLeaf('mf_users.country', 'string', '=', ['VN']));
  return {
    ...makeMeasureDraft(),
    artifactKind: 'segment',
    name: 'vn_users',
    filterTree: tree,
  };
}

describe('generateEntry — dispatch by artifactKind', () => {
  it('measure → identical output to generateV2 (regression gate)', () => {
    const draft = makeMeasureDraft();
    const dispatched = generateEntry(draft, CTX);
    const direct = generateV2(draft, CTX);
    expect(dispatched.fragment).toBe(direct.fragment);
    expect(dispatched.sectionKey).toBe('measures');
  });

  it('dimension → delegates to generateDimension', () => {
    const out = generateEntry(makeDimDraft(), CTX);
    expect(out.sectionKey).toBe('dimensions');
    const parsed = yaml.load(out.fragment) as any;
    expect(parsed.name).toBe('country');
    expect(parsed.type).toBe('string');
  });

  it('segment → delegates to generateSegment', () => {
    const out = generateEntry(makeSegmentDraft(), CTX);
    expect(out.sectionKey).toBe('segments');
    const parsed = yaml.load(out.fragment) as any;
    expect(parsed.name).toBe('vn_users');
    expect(parsed.sql).toBe("{country} = 'VN'");
  });

  it('throws on unknown artifactKind', () => {
    const broken = { ...makeMeasureDraft(), artifactKind: 'whatever' as any };
    expect(() => generateEntry(broken, CTX)).toThrow(/unsupported|unknown/i);
  });

  describe('meta.game_id stamping', () => {
    it('emits meta.game_id on measure when draft.gameId is set', () => {
      const draft = { ...makeMeasureDraft(), gameId: 'bal_vn' };
      const out = generateEntry(draft, CTX);
      const parsed = yaml.load(out.fragment) as any;
      expect(parsed.meta.game_id).toBe('bal_vn');
    });

    it('omits meta.game_id when draft.gameId is null', () => {
      const draft = { ...makeMeasureDraft(), gameId: null };
      const out = generateEntry(draft, CTX);
      const parsed = yaml.load(out.fragment) as any;
      expect(parsed.meta.game_id).toBeUndefined();
    });

    it('stamps meta.game_id on dimensions and segments too', () => {
      const dim = generateEntry({ ...makeDimDraft(), gameId: 'ptg' }, CTX);
      expect((yaml.load(dim.fragment) as any).meta.game_id).toBe('ptg');
      const seg = generateEntry({ ...makeSegmentDraft(), gameId: 'ptg' }, CTX);
      expect((yaml.load(seg.fragment) as any).meta.game_id).toBe('ptg');
    });
  });
});
