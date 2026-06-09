/**
 * Unit tests for the pure transform functions in cs-member360-derive.ts.
 *
 * No React / DOM needed — these are plain data transforms.
 */

import { describe, it, expect } from 'vitest';
import type { CareCase } from '../use-care-cases';
import {
  normalisePriority,
  casesToTimeline,
  pickTopOpenCase,
  caseToRecommendedAction,
  defaultGuidance,
} from '../member360/cs-member360-derive';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCase(overrides: Partial<CareCase> = {}): CareCase {
  return {
    id: 'c1',
    game_id: 'cfm_vn',
    playbook_id: 'pb1',
    playbook_name: 'High Roller Drop',
    playbook_priority: 1,
    uid: 'u1',
    source: 'membership',
    opened_at: '2026-06-01T10:00:00Z',
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
    ...overrides,
  };
}

// ── normalisePriority ─────────────────────────────────────────────────────────

describe('normalisePriority', () => {
  it('passes through canonical string values unchanged', () => {
    expect(normalisePriority('cao')).toBe('cao');
    expect(normalisePriority('tb')).toBe('tb');
    expect(normalisePriority('thap')).toBe('thap');
  });

  it('maps numeric rank 1 → cao', () => {
    expect(normalisePriority(1)).toBe('cao');
  });

  it('maps numeric rank 2–3 → tb', () => {
    expect(normalisePriority(2)).toBe('tb');
    expect(normalisePriority(3)).toBe('tb');
  });

  it('maps numeric rank 4+ → thap', () => {
    expect(normalisePriority(4)).toBe('thap');
    expect(normalisePriority(99)).toBe('thap');
  });

  it('maps undefined → thap (lowest-priority default)', () => {
    expect(normalisePriority(undefined)).toBe('thap');
  });

  it('parses a numeric string', () => {
    expect(normalisePriority('1')).toBe('cao');
    expect(normalisePriority('3')).toBe('tb');
  });
});

// ── casesToTimeline ───────────────────────────────────────────────────────────

describe('casesToTimeline', () => {
  it('returns an empty array for no cases', () => {
    expect(casesToTimeline([])).toHaveLength(0);
  });

  it('maps a new case to an "opened" event', () => {
    const events = casesToTimeline([makeCase({ status: 'new' })]);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('opened');
  });

  it('maps a treated case to a "treated" event', () => {
    const events = casesToTimeline([
      makeCase({ status: 'treated', treated_at: '2026-06-02T12:00:00Z' }),
    ]);
    expect(events[0].kind).toBe('treated');
  });

  it('maps a resolved case to a "resolved" event', () => {
    const events = casesToTimeline([makeCase({ status: 'resolved' })]);
    expect(events[0].kind).toBe('resolved');
  });

  it('uses the playbook_name from the case record', () => {
    const events = casesToTimeline([makeCase({ playbook_name: 'Spend Drop Alert' })]);
    expect(events[0].playbookName).toBe('Spend Drop Alert');
  });

  it('falls back to playbook_id when playbook_name is absent', () => {
    const events = casesToTimeline([makeCase({ playbook_name: undefined })]);
    expect(events[0].playbookName).toBe('pb1');
  });

  it('sorts newest opened_at first', () => {
    const old = makeCase({ id: 'old', opened_at: '2026-05-01T00:00:00Z' });
    const newer = makeCase({ id: 'new', opened_at: '2026-06-01T00:00:00Z' });
    const events = casesToTimeline([old, newer]);
    expect(events[0].id).toBe('evt-new');
    expect(events[1].id).toBe('evt-old');
  });

  it('propagates channel_used and notes', () => {
    const events = casesToTimeline([
      makeCase({ channel_used: 'call', notes: 'Called VIP', status: 'treated', treated_at: '2026-06-02T00:00:00Z' }),
    ]);
    expect(events[0].channel).toBe('call');
    expect(events[0].note).toBe('Called VIP');
  });
});

// ── pickTopOpenCase ───────────────────────────────────────────────────────────

describe('pickTopOpenCase', () => {
  it('returns null when there are no cases', () => {
    expect(pickTopOpenCase([])).toBeNull();
  });

  it('returns null when all cases are resolved/dismissed/treated', () => {
    const cases = [
      makeCase({ status: 'treated' }),
      makeCase({ id: 'c2', status: 'resolved' }),
      makeCase({ id: 'c3', status: 'dismissed' }),
    ];
    expect(pickTopOpenCase(cases)).toBeNull();
  });

  it('returns the single open case', () => {
    const open = makeCase({ status: 'new' });
    expect(pickTopOpenCase([open])).toBe(open);
  });

  it('picks the case with the lowest numeric priority rank', () => {
    const highPrio = makeCase({ id: 'h', playbook_priority: 1, status: 'new' });
    const lowPrio = makeCase({ id: 'l', playbook_priority: 3, status: 'new' });
    expect(pickTopOpenCase([lowPrio, highPrio])).toBe(highPrio);
  });

  it('breaks ties by earlier opened_at', () => {
    const first = makeCase({ id: 'f', playbook_priority: 2, opened_at: '2026-05-01T00:00:00Z', status: 'new' });
    const second = makeCase({ id: 's', playbook_priority: 2, opened_at: '2026-06-01T00:00:00Z', status: 'new' });
    expect(pickTopOpenCase([second, first])).toBe(first);
  });

  it('ignores treated cases even when they have higher priority', () => {
    const treated = makeCase({ id: 't', playbook_priority: 1, status: 'treated' });
    const open = makeCase({ id: 'o', playbook_priority: 3, status: 'new' });
    expect(pickTopOpenCase([treated, open])).toBe(open);
  });

  it('recognises in_review as open', () => {
    const inReview = makeCase({ status: 'in_review' });
    expect(pickTopOpenCase([inReview])).toBe(inReview);
  });
});

// ── caseToRecommendedAction ───────────────────────────────────────────────────

describe('caseToRecommendedAction', () => {
  it('maps case fields to a RecommendedAction', () => {
    const c = makeCase({ playbook_name: 'High Roller Drop', playbook_priority: 1 });
    const guidance = defaultGuidance('High Roller Drop', 'cao');
    const action = caseToRecommendedAction(c, guidance);

    expect(action.playbookId).toBe('pb1');
    expect(action.playbookName).toBe('High Roller Drop');
    expect(action.priority).toBe('cao');
    expect(action.channels).toContain('call');
    expect(action.script).toBeTruthy();
    expect(action.slaNote).toMatch(/24 h/);
  });

  it('falls back to playbook_id when playbook_name is absent', () => {
    const c = makeCase({ playbook_name: undefined });
    const guidance = defaultGuidance('pb1', 'tb');
    const action = caseToRecommendedAction(c, guidance);
    expect(action.playbookName).toBe('pb1');
  });
});

// ── defaultGuidance ───────────────────────────────────────────────────────────

describe('defaultGuidance', () => {
  it('returns a cao SLA note for cao priority', () => {
    const g = defaultGuidance('Test', 'cao');
    expect(g.slaNote).toMatch(/24 h/);
  });

  it('returns a tb SLA note for tb priority', () => {
    const g = defaultGuidance('Test', 'tb');
    expect(g.slaNote).toMatch(/72 h/);
  });

  it('returns a thap note for thap priority', () => {
    const g = defaultGuidance('Test', 'thap');
    expect(g.slaNote).toMatch(/sprint/i);
  });

  it('includes the playbook name in the why field', () => {
    const g = defaultGuidance('Spend Drop Alert', 'tb');
    expect(g.why).toContain('Spend Drop Alert');
  });
});
