import { describe, it, expect } from 'vitest';
import { resolveReturnPath, type EditorReturnTo } from '../editor-route-state';

describe('resolveReturnPath', () => {
  it('substitutes the created segment id for the :id placeholder', () => {
    const returnTo: EditorReturnTo = { pathTemplate: '/advisor/:id', state: { driveBoot: true } };
    expect(resolveReturnPath(returnTo, 'abc-123')).toBe('/advisor/abc-123');
  });

  it('returns a template without :id unchanged (fixed destination)', () => {
    const returnTo: EditorReturnTo = { pathTemplate: '/segments' };
    expect(resolveReturnPath(returnTo, 'abc-123')).toBe('/segments');
  });

  it('only replaces the first :id occurrence', () => {
    const returnTo: EditorReturnTo = { pathTemplate: '/x/:id/:id' };
    expect(resolveReturnPath(returnTo, '9')).toBe('/x/9/:id');
  });
});
