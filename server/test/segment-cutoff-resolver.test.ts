import { describe, it, expect } from 'vitest';
import {
  collectPercentileLeaves,
  resolveSegmentCutoffs,
  PopulationScopeRequiredError,
} from '../src/services/segment-cutoff-resolver.js';
import { buildPercentileSql } from '../src/services/percentile-cutoff-resolver.js';
import { predicateToSql } from '../src/services/predicate-to-sql.js';
import { treeToCubeFilters } from '../src/services/translator.js';
import type { PredicateNode, LeafNode } from '../src/types/predicate-tree.js';

function pctLeaf(id: string, member: string, over?: Record<string, unknown>): LeafNode {
  return { kind: 'leaf', id, member, type: 'number', op: 'percentileGte', values: [{ p: 75, over }] };
}

describe('collectPercentileLeaves', () => {
  it('finds percentile leaves at any depth, ignoring non-percentile leaves', () => {
    const tree: PredicateNode = {
      kind: 'group',
      id: 'g0',
      op: 'AND',
      children: [
        { kind: 'leaf', id: 'l1', member: 'mf_users.country', type: 'string', op: 'equals', values: ['VN'] },
        {
          kind: 'group',
          id: 'g1',
          op: 'OR',
          children: [
            pctLeaf('p1', 'mf_users.ltv_vnd', { table: 'g.cfm_vn.mf_users' }),
            pctLeaf('p2', 'mf_users.ltv_30d_vnd', { table: 'g.cfm_vn.mf_users' }),
          ],
        },
      ],
    };
    expect(collectPercentileLeaves(tree).map((l) => l.id)).toEqual(['p1', 'p2']);
  });

  it('returns [] for a tree with no percentile leaf', () => {
    const tree: PredicateNode = { kind: 'leaf', id: 'l', member: 'm', type: 'string', op: 'equals', values: ['x'] };
    expect(collectPercentileLeaves(tree)).toEqual([]);
  });
});

describe('resolveSegmentCutoffs', () => {
  it('is a no-op (empty map, no infra) for a tree with no percentile leaf', async () => {
    const tree: PredicateNode = { kind: 'leaf', id: 'l', member: 'm', type: 'string', op: 'equals', values: ['x'] };
    await expect(resolveSegmentCutoffs(tree)).resolves.toEqual(new Map());
  });

  it('rejects a percentile leaf with no population source (scope required, infra-independent)', async () => {
    const tree = pctLeaf('p1', 'mf_users.ltv_vnd'); // no over → unresolvable
    await expect(resolveSegmentCutoffs(tree)).rejects.toBeInstanceOf(PopulationScopeRequiredError);
  });
});

describe('buildPercentileSql population scope (WHERE)', () => {
  it('appends a WHERE clause when one is supplied', () => {
    const sql = buildPercentileSql({
      table: 'game_integration.cfm_vn.mf_users',
      column: 'ingame_total_recharge_value_vnd',
      p: 75,
      where: 'ingame_total_recharge_value_vnd > 0',
    });
    expect(sql).toBe(
      'SELECT approx_percentile(ingame_total_recharge_value_vnd, 0.75) AS cutoff ' +
        'FROM game_integration.cfm_vn.mf_users WHERE ingame_total_recharge_value_vnd > 0',
    );
  });

  it('emits no WHERE when none is supplied (unchanged behavior)', () => {
    const sql = buildPercentileSql({ table: 't', column: 'c', p: 50 });
    expect(sql).not.toContain('WHERE');
  });
});

describe('buildPercentileSql identity merge (jus dual-row mart)', () => {
  it('collapses to one row per user (split_part + max + GROUP BY) before the percentile', () => {
    const sql = buildPercentileSql({
      table: 'game_integration.jus_vn.mf_users',
      column: 'ingame_total_recharge_value_vnd',
      p: 75,
      where: 'ingame_total_recharge_value_vnd > 0',
      merge: { idColumn: 'user_id', transform: 'split_part_at', columns: ['ingame_total_recharge_value_vnd'] },
    });
    expect(sql).toBe(
      'SELECT approx_percentile(ingame_total_recharge_value_vnd, 0.75) AS cutoff FROM ' +
        "(SELECT split_part(user_id, '@', 1) AS user_id, " +
        'max(ingame_total_recharge_value_vnd) AS ingame_total_recharge_value_vnd ' +
        'FROM game_integration.jus_vn.mf_users GROUP BY 1) m WHERE ingame_total_recharge_value_vnd > 0',
    );
  });

  it('rejects an unknown merge transform', () => {
    expect(() =>
      buildPercentileSql({
        table: 't',
        column: 'c',
        p: 50,
        // @ts-expect-error testing runtime guard on an invalid transform
        merge: { idColumn: 'id', transform: 'evil', columns: ['c'] },
      }),
    ).toThrow(/unknown identityMerge transform/);
  });
});

describe('predicate-to-sql percentile with population filter', () => {
  it('compiles over.filter into the subquery WHERE (payer scoping)', () => {
    const leaf: LeafNode = {
      kind: 'leaf',
      id: 'p1',
      member: 'ltv_vnd',
      type: 'number',
      op: 'percentileGte',
      values: [
        {
          p: 75,
          over: {
            table: 'cfm.mf_users',
            column: 'ltv_vnd',
            filter: { kind: 'leaf', id: 'f', member: 'ltv_vnd', type: 'number', op: 'gt', values: [0] },
          },
        },
      ],
    };
    const sql = predicateToSql(leaf);
    expect(sql).toBe('ltv_vnd >= (SELECT approx_percentile(ltv_vnd, 0.75) AS cutoff FROM cfm.mf_users WHERE ltv_vnd > 0)');
  });
});

describe('translator resolves percentile leaf to a scalar via the cutoff map', () => {
  it('compiles percentileGte to a gte against the resolved cutoff', () => {
    const tree = pctLeaf('p1', 'mf_users.ltv_vnd', { table: 'g.cfm_vn.mf_users' });
    const filters = treeToCubeFilters(tree, { resolvedPercentiles: new Map([['p1', 743816]]) });
    expect(filters).toEqual([{ member: 'mf_users.ltv_vnd', operator: 'gte', values: ['743816'] }]);
  });
});
