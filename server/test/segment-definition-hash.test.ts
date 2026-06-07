/**
 * Definition hash — stable across JSON key order, sensitive to predicate
 * edits (and uid-list edits on manual segments only), insensitive to renames
 * and refresh-time uid churn on predicate segments.
 */

import { describe, it, expect } from 'vitest';
import { segmentDefinitionHash } from '../src/services/segment-definition-hash.js';

const baseTree = JSON.stringify({
  kind: 'group', id: 'root', op: 'AND',
  children: [{ kind: 'leaf', id: 'l1', member: 'mf_users.payer_tier', type: 'string', op: 'equals', values: ['whale'] }],
});

const base = {
  type: 'predicate',
  cube: 'mf_users',
  game_id: 'ballistar',
  predicate_tree_json: baseTree,
};

describe('segmentDefinitionHash', () => {
  it('is a 16-char hex string and deterministic', () => {
    const h = segmentDefinitionHash(base);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(segmentDefinitionHash(base)).toBe(h);
  });

  it('is stable across predicate-tree key order', () => {
    const reordered = JSON.stringify({
      op: 'AND', id: 'root', kind: 'group',
      children: [{ values: ['whale'], op: 'equals', type: 'string', member: 'mf_users.payer_tier', id: 'l1', kind: 'leaf' }],
    });
    expect(segmentDefinitionHash({ ...base, predicate_tree_json: reordered })).toBe(
      segmentDefinitionHash(base),
    );
  });

  it('changes when the predicate changes', () => {
    const edited = baseTree.replace('whale', 'dolphin');
    expect(segmentDefinitionHash({ ...base, predicate_tree_json: edited })).not.toBe(
      segmentDefinitionHash(base),
    );
  });

  it('ignores uid_list churn on predicate segments (refresh must not bust caches)', () => {
    expect(segmentDefinitionHash({ ...base, uid_list_json: '["u1","u2"]' })).toBe(
      segmentDefinitionHash({ ...base, uid_list_json: '["u9"]' }),
    );
  });

  it('hashes the uid list on manual segments — the list IS the definition', () => {
    const manual = { type: 'manual', cube: null, game_id: 'ballistar', predicate_tree_json: null };
    const a = segmentDefinitionHash({ ...manual, uid_list_json: '["u1","u2"]' });
    const b = segmentDefinitionHash({ ...manual, uid_list_json: '["u1","u3"]' });
    expect(a).not.toBe(b);
  });

  it('changes when cube or game changes', () => {
    expect(segmentDefinitionHash({ ...base, cube: 'etl_money_flow' })).not.toBe(segmentDefinitionHash(base));
    expect(segmentDefinitionHash({ ...base, game_id: 'cfm_vn' })).not.toBe(segmentDefinitionHash(base));
  });
});
