import { describe, it, expect } from 'vitest';
import { flattenToSql } from '../flatten-to-sql';
import { emptyTree, makeLeaf, makeGroup, addLeaf } from '../builders';
import { FilterLeaf, FilterGroup } from '../types';

function strLeaf(col: string, op: any, ...values: string[]): FilterLeaf {
  return { kind: 'leaf', id: 'l1', column: col, columnType: 'string', op, values };
}
function numLeaf(col: string, op: any, value: string): FilterLeaf {
  return { kind: 'leaf', id: 'l1', column: col, columnType: 'number', op, values: [value] };
}

describe('flattenToSql', () => {
  it('emits empty string for empty root', () => {
    expect(flattenToSql(emptyTree())).toBe('');
  });

  it('quotes a single string equals', () => {
    expect(flattenToSql(strLeaf('mf_users.tier', '=', 'premium')))
      .toBe("{mf_users.tier} = 'premium'");
  });

  it('escapes single quotes in string value (O\'Brien)', () => {
    expect(flattenToSql(strLeaf('mf_users.name', '=', "O'Brien")))
      .toBe("{mf_users.name} = 'O''Brien'");
  });

  it('emits numeric value raw', () => {
    expect(flattenToSql(numLeaf('mf_users.age', '>', '21')))
      .toBe('{mf_users.age} > 21');
  });

  it('rejects non-numeric value for numeric column', () => {
    expect(() => flattenToSql(numLeaf('mf_users.age', '>', 'abc'))).toThrow(/non-numeric/);
  });

  it('rejects control bytes in value', () => {
    expect(() => flattenToSql(strLeaf('mf_users.note', '=', 'bad\x00val'))).toThrow(/control bytes/);
  });

  it('rejects CR / LF in value', () => {
    expect(() => flattenToSql(strLeaf('mf_users.note', '=', 'foo\nbar'))).toThrow(/control bytes/);
  });

  it('parenthesises IN list', () => {
    expect(flattenToSql(strLeaf('mf_users.tier', 'IN', 'premium', 'whale')))
      .toBe("{mf_users.tier} IN ('premium', 'whale')");
  });

  it('IN list throws when empty', () => {
    expect(() => flattenToSql(strLeaf('mf_users.tier', 'IN'))).toThrow(/at least one value/);
  });

  it('emits IS NULL / IS NOT NULL for set/notSet', () => {
    expect(flattenToSql(strLeaf('mf_users.email', 'set'))).toBe('{mf_users.email} IS NOT NULL');
    expect(flattenToSql(strLeaf('mf_users.email', 'notSet'))).toBe('{mf_users.email} IS NULL');
  });

  it('parenthesises AND with two leaves', () => {
    const root: FilterGroup = makeGroup('AND', [
      strLeaf('mf_users.tier', '=', 'premium'),
      strLeaf('mf_users.country', '=', 'VN'),
    ]);
    expect(flattenToSql(root))
      .toBe("({mf_users.tier} = 'premium') AND ({mf_users.country} = 'VN')");
  });

  it('parenthesises nested AND/OR tree', () => {
    const orGroup: FilterGroup = makeGroup('OR', [
      strLeaf('mf_users.country', '=', 'VN'),
      strLeaf('mf_users.country', '=', 'TH'),
    ]);
    const andRoot: FilterGroup = makeGroup('AND', [
      strLeaf('mf_users.tier', '=', 'premium'),
      orGroup,
    ]);
    expect(flattenToSql(andRoot)).toBe(
      "({mf_users.tier} = 'premium') AND (({mf_users.country} = 'VN') OR ({mf_users.country} = 'TH'))"
    );
  });

  it('throws on unknown column type', () => {
    const leaf: FilterLeaf = {
      kind: 'leaf',
      id: 'x',
      column: 'mf_users.weird',
      columnType: 'bytes' as any,
      op: '=',
      values: ['x'],
    };
    expect(() => flattenToSql(leaf)).toThrow(/unknown column type/);
  });

  it('emits boolean as lowercase literal', () => {
    const leaf: FilterLeaf = {
      kind: 'leaf', id: 'x', column: 'mf_users.is_active',
      columnType: 'boolean', op: '=', values: ['True'],
    };
    expect(flattenToSql(leaf)).toBe('{mf_users.is_active} = true');
  });

  it('LIKE escapes percent and quote in contains', () => {
    const leaf = strLeaf('mf_users.name', 'contains', "O'%test");
    expect(flattenToSql(leaf)).toBe("{mf_users.name} LIKE '%O''%%test%'");
  });

  it('omits empty inner group from output', () => {
    const root = makeGroup('AND', [
      strLeaf('mf_users.tier', '=', 'premium'),
      makeGroup('OR', []),
    ]);
    expect(flattenToSql(root)).toBe("{mf_users.tier} = 'premium'");
  });
});

describe('builders integration', () => {
  it('addLeaf into an empty tree', () => {
    const root = emptyTree();
    const leaf = makeLeaf('mf_users.tier', 'string', '=', ['premium']);
    const next = addLeaf(root, root.id, leaf);
    expect(next.children).toHaveLength(1);
    expect(flattenToSql(next)).toBe("{mf_users.tier} = 'premium'");
  });
});
