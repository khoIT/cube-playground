import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { generateDimension } from '../generate-dimension';
import type { NewMetricDraftV3 } from '../../types';
import { emptyTree, makeLeaf } from '../../filter-tree';

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
    artifactKind: 'dimension',
    ...overrides,
  };
}

const CTX = {
  sourceCube: 'mf_users',
  createdAt: '2026-05-17T22:30:00.000Z',
  author: 'khoitn',
};

describe('generateDimension — banding (case.when[] + else)', () => {
  it('emits case block with {CUBE}.<raw_col> form in when[].sql', () => {
    const draft = makeDraft({
      name: 'payer_tier',
      dimKind: 'banding',
      dimBuilder: {
        kind: 'banding',
        column: 'ltv_vnd',
        bands: [
          { sql: '{CUBE}.ltv_vnd >= 10000000', label: 'whale' },
          { sql: '{CUBE}.ltv_vnd >= 1000000', label: 'dolphin' },
        ],
        elseLabel: 'non_payer',
      },
    });
    const out = generateDimension(draft, CTX);
    expect(out.sectionKey).toBe('dimensions');

    const parsed = yaml.load(out.fragment) as any;
    expect(parsed.name).toBe('payer_tier');
    expect(parsed.type).toBe('string');
    expect(parsed.case.when).toHaveLength(2);
    expect(parsed.case.when[0].sql).toBe('{CUBE}.ltv_vnd >= 10000000');
    expect(parsed.case.when[0].label).toBe('whale');
    expect(parsed.case.else.label).toBe('non_payer');
    expect(parsed.meta.source).toBe('wizard');
  });

  it('preserves outer key order name, type, case, [title], [description], meta', () => {
    const draft = makeDraft({
      name: 'tier',
      title: 'Tier',
      description: 'tier desc',
      dimKind: 'banding',
      dimBuilder: {
        kind: 'banding',
        column: 'ltv_vnd',
        bands: [{ sql: '{CUBE}.ltv_vnd > 0', label: 'paying' }],
        elseLabel: 'non_payer',
      },
    });
    const out = generateDimension(draft, CTX);
    const keys = Object.keys(yaml.load(out.fragment) as object);
    expect(keys).toEqual(['name', 'type', 'case', 'title', 'description', 'meta']);
  });

  it('round-trip parse/dump → semantic equality', () => {
    const draft = makeDraft({
      name: 'payer_tier',
      dimKind: 'banding',
      dimBuilder: {
        kind: 'banding',
        column: 'ltv_vnd',
        bands: [{ sql: '{CUBE}.ltv_vnd >= 10000000', label: 'whale' }],
        elseLabel: 'non_payer',
      },
    });
    const out = generateDimension(draft, CTX);
    const once = yaml.load(out.fragment);
    const twice = yaml.load(yaml.dump(once));
    expect(once).toEqual(twice);
  });
});

describe('generateDimension — time-since', () => {
  it('day unit emits DATE_DIFF with {CUBE}.<col> form and type number', () => {
    const draft = makeDraft({
      name: 'days_since_install',
      dimKind: 'time-since',
      dimBuilder: { kind: 'time-since', timeColumn: 'install_date', unit: 'day' },
    });
    const out = generateDimension(draft, CTX);
    const parsed = yaml.load(out.fragment) as any;
    expect(parsed.name).toBe('days_since_install');
    expect(parsed.type).toBe('number');
    expect(parsed.sql).toBe("DATE_DIFF('day', {CUBE}.install_date, CURRENT_DATE)");
  });

  it('hour unit', () => {
    const draft = makeDraft({
      name: 'hours_since_login',
      dimKind: 'time-since',
      dimBuilder: { kind: 'time-since', timeColumn: 'last_login_at', unit: 'hour' },
    });
    const out = generateDimension(draft, CTX);
    const parsed = yaml.load(out.fragment) as any;
    expect(parsed.sql).toBe("DATE_DIFF('hour', {CUBE}.last_login_at, CURRENT_DATE)");
  });

  it('throws on missing timeColumn', () => {
    const draft = makeDraft({
      name: 'x',
      dimKind: 'time-since',
      dimBuilder: { kind: 'time-since', timeColumn: null, unit: 'day' },
    });
    expect(() => generateDimension(draft, CTX)).toThrow(/timeColumn/i);
  });
});

describe('generateDimension — passthrough', () => {
  it('emits bare column + type (no {CUBE}. template)', () => {
    const draft = makeDraft({
      name: 'country',
      dimKind: 'passthrough',
      dimBuilder: {
        kind: 'passthrough',
        column: 'unified_first_country_code',
        outputType: 'string',
      },
    });
    const out = generateDimension(draft, CTX);
    const parsed = yaml.load(out.fragment) as any;
    expect(parsed.name).toBe('country');
    expect(parsed.sql).toBe('unified_first_country_code');
    expect(parsed.type).toBe('string');
  });

  it('throws on missing column', () => {
    const draft = makeDraft({
      name: 'x',
      dimKind: 'passthrough',
      dimBuilder: { kind: 'passthrough', column: null, outputType: 'string' },
    });
    expect(() => generateDimension(draft, CTX)).toThrow(/column/i);
  });
});

describe('generateDimension — boolean', () => {
  it('wraps predicate in CASE WHEN ... THEN TRUE ELSE FALSE', () => {
    const leaf = makeLeaf('ltv_vnd', 'number', '>', ['0']);
    const draft = makeDraft({
      name: 'is_paying_user',
      dimKind: 'boolean',
      dimBuilder: { kind: 'boolean', predicate: leaf },
    });
    const out = generateDimension(draft, CTX);
    const parsed = yaml.load(out.fragment) as any;
    expect(parsed.name).toBe('is_paying_user');
    expect(parsed.type).toBe('boolean');
    expect(parsed.sql).toMatch(/^CASE WHEN .+ THEN TRUE ELSE FALSE END$/);
    // Predicate side uses {CUBE}.<col> form per F-2.
    expect(parsed.sql).toContain('{CUBE}.ltv_vnd');
    expect(parsed.sql).toContain('> 0');
  });

  it('rejects predicate that resolves to control bytes (F-5)', () => {
    const leaf = makeLeaf('ltv_vnd', 'string', '=', ["bad\nvalue"]);
    const draft = makeDraft({
      name: 'is_bad',
      dimKind: 'boolean',
      dimBuilder: { kind: 'boolean', predicate: leaf },
    });
    expect(() => generateDimension(draft, CTX)).toThrow(/control bytes|control byte|reject/i);
  });

  it('throws on missing predicate', () => {
    const draft = makeDraft({
      name: 'x',
      dimKind: 'boolean',
      dimBuilder: { kind: 'boolean', predicate: null },
    });
    expect(() => generateDimension(draft, CTX)).toThrow(/predicate/i);
  });
});

describe('generateDimension — sectionKey + meta', () => {
  it('emits sectionKey "dimensions" for every sub-kind', () => {
    const draft = makeDraft({
      name: 'country',
      dimKind: 'passthrough',
      dimBuilder: { kind: 'passthrough', column: 'country', outputType: 'string' },
    });
    expect(generateDimension(draft, CTX).sectionKey).toBe('dimensions');
  });

  it('emits meta block with source, author, created_at, grain, visibility', () => {
    const draft = makeDraft({
      name: 'country',
      dimKind: 'passthrough',
      dimBuilder: { kind: 'passthrough', column: 'country', outputType: 'string' },
    });
    const parsed = yaml.load(generateDimension(draft, CTX).fragment) as any;
    expect(parsed.meta).toMatchObject({
      source: 'wizard',
      author: 'khoitn',
      created_at: '2026-05-17T22:30:00.000Z',
      grain: 'daily',
      visibility: 'team',
    });
  });
});

describe('generateDimension — unknown dimKind', () => {
  it('throws when dimBuilder kind is unknown', () => {
    const draft = makeDraft({
      name: 'x',
      dimKind: 'banding',
      dimBuilder: { kind: 'banding', column: 'x', bands: [], elseLabel: '' },
    });
    // Empty bands → still valid mapping (downstream validator may reject), but
    // explicit-throw is for unknown kind. Patch in a bogus value.
    const broken = { ...draft, dimBuilder: { kind: 'wat', column: 'x' } as any };
    expect(() => generateDimension(broken, CTX)).toThrow(/unknown|unsupported/i);
  });
});
