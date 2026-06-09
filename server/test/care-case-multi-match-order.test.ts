/**
 * Server-side multi-playbook promotion: over the FULL case set (before paging),
 * VIPs matching several selected playbooks must lead so they land on page 1.
 * Verifies overlap-first order, priority/recency tiebreaks, and group clustering.
 */

import { describe, it, expect } from 'vitest';
import { promoteMultiMatchCases, type OrderableCase } from '../src/care/care-case-multi-match-order.js';

interface C extends OrderableCase {
  id: string;
  prio?: number;
}

const mk = (id: string, uid: string, playbook_id: string, prio = 1, opened_at = '2026-06-01T00:00:00.000Z'): C => ({
  id,
  uid,
  playbook_id,
  prio,
  opened_at,
});

const rankOf = (c: C) => c.prio ?? 1;

describe('promoteMultiMatchCases', () => {
  it('floats a multi-match VIP above single-match VIPs even at lower priority', () => {
    const cases = [
      mk('s1', 'single', '01', 0), // cao, but only one playbook
      mk('m1', 'multi', '01', 2),  // thap, but spans two playbooks
      mk('m2', 'multi', '02', 2),
    ];
    const ordered = promoteMultiMatchCases(cases, rankOf);
    expect(ordered.slice(0, 2).map((c) => c.uid)).toEqual(['multi', 'multi']); // both rows lead
    expect(ordered[2].uid).toBe('single');
  });

  it('clusters each VIP\'s rows together rather than interleaving', () => {
    const cases = [
      mk('a1', 'a', '01'),
      mk('b1', 'b', '01'),
      mk('a2', 'a', '02'),
      mk('b2', 'b', '02'),
    ];
    const ordered = promoteMultiMatchCases(cases, rankOf).map((c) => c.uid);
    // both span 2 → equal overlap; each VIP's two rows must be adjacent.
    expect(ordered).toEqual([ordered[0], ordered[0], ordered[2], ordered[2]]);
  });

  it('breaks equal overlap by priority then recency', () => {
    const cases = [
      mk('low', 'low', '01', 2, '2026-06-05T00:00:00.000Z'),
      mk('hi', 'hi', '01', 0, '2026-06-01T00:00:00.000Z'),
      mk('tbOld', 'old', '01', 1, '2026-06-01T00:00:00.000Z'),
      mk('tbNew', 'new', '01', 1, '2026-06-07T00:00:00.000Z'),
    ];
    const ordered = promoteMultiMatchCases(cases, rankOf).map((c) => c.uid);
    expect(ordered).toEqual(['hi', 'new', 'old', 'low']);
  });
});
