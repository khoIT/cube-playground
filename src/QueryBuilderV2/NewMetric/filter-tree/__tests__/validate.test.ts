import { describe, it, expect } from 'vitest';
import { validateTree } from '../validate';
import { emptyTree, makeLeaf, makeGroup, addLeaf } from '../builders';

const ELIGIBLE = new Set(['mf_users.tier', 'mf_users.country', 'mf_users.age']);

describe('validateTree', () => {
  it('passes for a populated AND tree of eligible columns', () => {
    const root = makeGroup('AND', [
      makeLeaf('mf_users.tier', 'string', '=', ['premium']),
      makeLeaf('mf_users.age', 'number', '>', ['18']),
    ]);
    expect(validateTree(root, ELIGIBLE)).toEqual([]);
  });

  it('errors on column not in eligible set', () => {
    const root = makeGroup('AND', [makeLeaf('mf_users.bogus', 'string', '=', ['x'])]);
    const errs = validateTree(root, ELIGIBLE);
    expect(errs.some((e) => e.level === 'error' && /not part of/.test(e.message))).toBe(true);
  });

  it('errors when a non-unary op has no values', () => {
    const root = makeGroup('AND', [makeLeaf('mf_users.tier', 'string', '=', [])]);
    const errs = validateTree(root, ELIGIBLE);
    expect(errs.some((e) => /requires at least one value/.test(e.message))).toBe(true);
  });

  it('warns on empty group', () => {
    const t = emptyTree();
    const errs = validateTree(t, ELIGIBLE);
    expect(errs.some((e) => e.level === 'warning' && /Empty group/.test(e.message))).toBe(true);
  });

  it('errors when numeric column has non-numeric value', () => {
    const root = makeGroup('AND', [makeLeaf('mf_users.age', 'number', '>', ['abc'])]);
    const errs = validateTree(root, ELIGIBLE);
    expect(errs.some((e) => /not numeric/.test(e.message))).toBe(true);
  });

  it('errors when boolean column has non-boolean value', () => {
    const root = makeGroup('AND', [
      makeLeaf('mf_users.tier', 'boolean', '=', ['yes']),
    ]);
    // tier is eligible but treated as boolean here for test
    const errs = validateTree(root, new Set(['mf_users.tier']));
    expect(errs.some((e) => /not boolean/.test(e.message))).toBe(true);
  });
});
