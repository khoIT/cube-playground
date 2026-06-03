/**
 * Segment access predicates — personal is owner/admin-only; shared/org are
 * workspace-collaborative; NULL visibility behaves as personal.
 */

import { describe, it, expect } from 'vitest';
import { canAccessSegment, canMutateSegment } from '../src/auth/can-access-segment.js';
import type { Principal } from '../src/auth/principal.js';

function principal(sub: string, role: Principal['role'] = 'editor'): Principal {
  return { sub, email: `${sub}@x`, role, workspaces: [], allowedGames: [], features: {} };
}

const owner = principal('alice-sub');
const other = principal('bob-sub');
const admin = principal('admin-sub', 'admin');

describe('canAccessSegment / canMutateSegment', () => {
  it('owner can read+mutate their own personal segment', () => {
    const row = { owner: 'alice-sub', visibility: 'personal' };
    expect(canAccessSegment(owner, row)).toBe(true);
    expect(canMutateSegment(owner, row)).toBe(true);
  });

  it('NULL visibility behaves as personal — other users denied', () => {
    const row = { owner: 'alice-sub', visibility: null };
    expect(canAccessSegment(other, row)).toBe(false);
    expect(canMutateSegment(other, row)).toBe(false);
    // owner still sees their own NULL-visibility segment
    expect(canAccessSegment(owner, row)).toBe(true);
  });

  it('other user denied on a personal segment (read + mutate)', () => {
    const row = { owner: 'alice-sub', visibility: 'personal' };
    expect(canAccessSegment(other, row)).toBe(false);
    expect(canMutateSegment(other, row)).toBe(false);
  });

  it('shared segment is accessible+mutable by any workspace member', () => {
    const row = { owner: 'alice-sub', visibility: 'shared' };
    expect(canAccessSegment(other, row)).toBe(true);
    expect(canMutateSegment(other, row)).toBe(true);
  });

  it('org segment is accessible by any workspace member', () => {
    const row = { owner: 'alice-sub', visibility: 'org' };
    expect(canAccessSegment(other, row)).toBe(true);
  });

  it('admin can read+mutate any segment regardless of visibility/owner', () => {
    const row = { owner: 'alice-sub', visibility: 'personal' };
    expect(canAccessSegment(admin, row)).toBe(true);
    expect(canMutateSegment(admin, row)).toBe(true);
  });
});
