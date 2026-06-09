/**
 * Multi-playbook promotion ordering for the By-Playbook lens. Verifies that VIPs
 * matching several of the selected playbooks float to the top, with priority and
 * recency tie-breaks, and that single-playbook selections keep server order.
 */

import { describe, it, expect } from 'vitest';
import { orderByMultiMatch } from '../case-ledger-ordering';
import type { CareCase } from '../use-care-cases';

function mk(partial: Partial<CareCase> & { id: string; uid: string; playbook_id: string }): CareCase {
  return {
    game_id: 'cfm_vn',
    source: 'membership',
    opened_at: '2026-06-01T00:00:00.000Z',
    stats_snapshot_json: null,
    status: 'new',
    condition_lapsed: 0,
    assignee: null,
    treated_at: null,
    channel_used: null,
    action_taken: null,
    notes: null,
    kpi_target: null,
    kpi_eval_at: null,
    outcome: null,
    playbook_priority: 'tb',
    ...partial,
  } as CareCase;
}

describe('orderByMultiMatch', () => {
  it('keeps server order and still counts matches when not multi-select', () => {
    const cases = [
      mk({ id: '1', uid: 'a', playbook_id: '01' }),
      mk({ id: '2', uid: 'b', playbook_id: '01' }),
    ];
    const { ordered, matchCountByUid } = orderByMultiMatch(cases, false);
    expect(ordered.map((c) => c.id)).toEqual(['1', '2']); // unchanged
    expect(matchCountByUid.get('a')).toBe(1);
  });

  it('promotes a VIP matching multiple selected playbooks above single-match VIPs', () => {
    const cases = [
      mk({ id: 's1', uid: 'single', playbook_id: '01', playbook_priority: 'cao' }),
      mk({ id: 'm1', uid: 'multi', playbook_id: '01', playbook_priority: 'thap' }),
      mk({ id: 'm2', uid: 'multi', playbook_id: '04', playbook_priority: 'thap' }),
    ];
    const { ordered, matchCountByUid } = orderByMultiMatch(cases, true);
    // 'multi' spans 2 playbooks → both its rows lead, despite lower priority.
    expect(ordered.slice(0, 2).map((c) => c.uid)).toEqual(['multi', 'multi']);
    expect(ordered[2].uid).toBe('single');
    expect(matchCountByUid.get('multi')).toBe(2);
    expect(matchCountByUid.get('single')).toBe(1);
  });

  it('breaks equal-overlap ties by priority then recency', () => {
    const cases = [
      mk({ id: 'low', uid: 'low', playbook_id: '01', playbook_priority: 'thap', opened_at: '2026-06-05T00:00:00.000Z' }),
      mk({ id: 'hi', uid: 'hi', playbook_id: '01', playbook_priority: 'cao', opened_at: '2026-06-01T00:00:00.000Z' }),
      mk({ id: 'tbOld', uid: 'old', playbook_id: '01', playbook_priority: 'tb', opened_at: '2026-06-01T00:00:00.000Z' }),
      mk({ id: 'tbNew', uid: 'new', playbook_id: '01', playbook_priority: 'tb', opened_at: '2026-06-07T00:00:00.000Z' }),
    ];
    const { ordered } = orderByMultiMatch(cases, true);
    // All overlap=1 → priority cao first, then tb (recent before old), then thap.
    expect(ordered.map((c) => c.uid)).toEqual(['hi', 'new', 'old', 'low']);
  });
});
