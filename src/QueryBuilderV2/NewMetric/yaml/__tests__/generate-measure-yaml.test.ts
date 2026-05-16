import { describe, it, expect } from 'vitest';
import { generate, GenerateContext } from '../generate-measure-yaml';
import { NewMetricDraft } from '../../types';
import { ReachableMember } from '../../hooks/use-reachable-members';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function member(
  cubeName: string,
  shortName: string,
  kind: 'dimension' | 'measure' = 'measure',
  viaJoin?: ReachableMember['viaJoin']
): ReachableMember {
  return {
    cubeName,
    shortName,
    memberName: `${cubeName}.${shortName}`,
    kind,
    viaJoin,
  };
}

const ORDERS_MEMBERS: ReachableMember[] = [
  member('orders', 'amount'),
  member('orders', 'id'),
  member('orders', 'status', 'dimension'),
];

const CROSS_CUBE_MEMBERS: ReachableMember[] = [
  ...ORDERS_MEMBERS,
  member('users', 'id', 'measure', { fromCube: 'orders', sql: 'orders.user_id = users.id' }),
  member('users', 'email', 'dimension', { fromCube: 'orders', sql: 'orders.user_id = users.id' }),
];

const BASE_DRAFT: NewMetricDraft = {
  sourceCube: 'orders',
  operation: 'sum',
  ofMember: 'orders.amount',
  ofMemberB: null,
  filter: null,
  name: 'total_revenue',
  title: 'Total Revenue',
  description: '',
  format: 'number',
};

function ctx(
  members: ReachableMember[] = ORDERS_MEMBERS,
  peers: string[] = ['order_count', 'total_revenue']
): GenerateContext {
  return { sourceCube: 'orders', reachableMembers: members, peerMeasureNames: peers };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('generate() — sum, same-cube, no filter', () => {
  it('produces yaml and fragment strings', () => {
    const { yaml, fragment } = generate(BASE_DRAFT, ctx());
    expect(yaml).toContain('measures:');
    expect(yaml).toContain('name: total_revenue');
    expect(yaml).toContain('type: sum');
    expect(yaml).toContain('sql: \'{orders}.amount\'');
    expect(fragment).toContain('name: total_revenue');
    expect(fragment).not.toContain('measures:');
  });

  it('yaml preview starts with measures: and indented list item', () => {
    const { yaml } = generate(BASE_DRAFT, ctx());
    expect(yaml.startsWith('measures:\n  - ')).toBe(true);
  });

  it('stable key order: name, type, sql before title', () => {
    const { fragment } = generate(BASE_DRAFT, ctx());
    const nameIdx = fragment.indexOf('name:');
    const typeIdx = fragment.indexOf('type:');
    const sqlIdx = fragment.indexOf('sql:');
    const titleIdx = fragment.indexOf('title:');
    expect(nameIdx).toBeLessThan(typeIdx);
    expect(typeIdx).toBeLessThan(sqlIdx);
    expect(sqlIdx).toBeLessThan(titleIdx);
  });

  it('omits description and format when default', () => {
    const { fragment } = generate(BASE_DRAFT, ctx());
    expect(fragment).not.toContain('description:');
    expect(fragment).not.toContain('format:');
  });
});

describe('generate() — countDistinct, cross-cube via join', () => {
  const draft: NewMetricDraft = {
    ...BASE_DRAFT,
    operation: 'countDistinct',
    ofMember: 'users.id',
    name: 'unique_users',
    title: 'Unique Users',
  };

  it('emits type: count_distinct', () => {
    const { fragment } = generate(draft, ctx(CROSS_CUBE_MEMBERS));
    expect(fragment).toContain('type: count_distinct');
  });

  it('emits cross-cube sql reference', () => {
    const { fragment } = generate(draft, ctx(CROSS_CUBE_MEMBERS));
    expect(fragment).toContain('{users}.id');
  });
});

describe('generate() — ratio, same-cube', () => {
  const draft: NewMetricDraft = {
    ...BASE_DRAFT,
    operation: 'ratio',
    ofMember: 'orders.amount',
    ofMemberB: 'orders.id',
    name: 'avg_order_value',
    title: 'Avg Order Value',
  };

  it('emits type: number', () => {
    const { fragment } = generate(draft, ctx());
    expect(fragment).toContain('type: number');
  });

  it('emits NULLIF division sql using source-cube references', () => {
    const { fragment } = generate(draft, ctx());
    expect(fragment).toContain('{orders}.amount');
    expect(fragment).toContain('NULLIF(');
    expect(fragment).toContain('{orders}.id');
  });
});

describe('generate() — with filters', () => {
  it('emits filters for equals operator', () => {
    const draft: NewMetricDraft = {
      ...BASE_DRAFT,
      filter: { member: 'orders.status', operator: 'equals', values: ['paid'] },
    };
    const { fragment } = generate(draft, ctx());
    expect(fragment).toContain('filters:');
    // js-yaml serialises strings containing curly-braces in single-quote style,
    // escaping interior single quotes as ''. Verify the key parts are present.
    expect(fragment).toContain('{orders}.status');
    expect(fragment).toContain('paid');
    expect(fragment).toMatch(/sql:/);
  });

  it('emits IS NOT NULL for set (isNotNull) operator', () => {
    const draft: NewMetricDraft = {
      ...BASE_DRAFT,
      filter: { member: 'orders.status', operator: 'set' } as any,
    };
    const { fragment } = generate(draft, ctx());
    expect(fragment).toContain('IS NOT NULL');
  });

  it('omits filters when filter is null', () => {
    const { fragment } = generate(BASE_DRAFT, ctx());
    expect(fragment).not.toContain('filters:');
  });
});

describe('generate() — naming convention', () => {
  it('converts snake_case name to camelCase when peers are camelCase', () => {
    const camelPeers = ['totalRevenue', 'orderCount', 'avgValue'];
    const draft: NewMetricDraft = { ...BASE_DRAFT, name: 'unique_users' };
    const { fragment } = generate(draft, ctx(ORDERS_MEMBERS, camelPeers));
    expect(fragment).toContain('name: uniqueUsers');
  });

  it('keeps snake_case name when peers are snake_case (default)', () => {
    const snakePeers = ['total_revenue', 'order_count'];
    const draft: NewMetricDraft = { ...BASE_DRAFT, name: 'unique_users' };
    const { fragment } = generate(draft, ctx(ORDERS_MEMBERS, snakePeers));
    expect(fragment).toContain('name: unique_users');
  });

  it('falls back to snake when peers empty', () => {
    const draft: NewMetricDraft = { ...BASE_DRAFT, name: 'order_count' };
    const { fragment } = generate(draft, ctx(ORDERS_MEMBERS, []));
    expect(fragment).toContain('name: order_count');
  });
});

describe('generate() — optional fields', () => {
  it('includes description when set', () => {
    const draft: NewMetricDraft = { ...BASE_DRAFT, description: 'Sum of all order amounts' };
    const { fragment } = generate(draft, ctx());
    expect(fragment).toContain('description:');
    expect(fragment).toContain('Sum of all order amounts');
  });

  it('includes format when non-default (currency)', () => {
    const draft: NewMetricDraft = { ...BASE_DRAFT, format: 'currency' };
    const { fragment } = generate(draft, ctx());
    expect(fragment).toContain('format: currency');
  });

  it('omits format when number (default)', () => {
    const { fragment } = generate(BASE_DRAFT, ctx());
    expect(fragment).not.toContain('format:');
  });
});

describe('generate() — all operation types', () => {
  const ops: Array<[NewMetricDraft['operation'], string]> = [
    ['sum', 'sum'],
    ['count', 'count'],
    ['countDistinct', 'count_distinct'],
    ['avg', 'avg'],
    ['min', 'min'],
    ['max', 'max'],
    ['ratio', 'number'],
  ];

  for (const [op, expectedType] of ops) {
    it(`maps ${op} → type: ${expectedType}`, () => {
      const draft: NewMetricDraft = {
        ...BASE_DRAFT,
        operation: op,
        ofMemberB: op === 'ratio' ? 'orders.id' : null,
      };
      const { fragment } = generate(draft, ctx());
      expect(fragment).toContain(`type: ${expectedType}`);
    });
  }
});
