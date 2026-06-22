import { describe, it, expect } from 'vitest';
import { deriveTurnScope } from '../derive-turn-scope';
import type { QueryArtifact } from '../../../../api/chat-sse-client';

function artifact(query: unknown, over: Partial<QueryArtifact> = {}): QueryArtifact {
  return {
    id: 'a1',
    title: 'T',
    summary: '',
    query,
    source: 'raw',
    deeplinkUrl: '',
    deeplinkVia: 'inline',
    payload: {},
    ...over,
  };
}

describe('deriveTurnScope', () => {
  it('returns null when no artifacts (clarification / chit-chat turn)', () => {
    expect(deriveTurnScope([])).toBeNull();
  });

  it('extracts measures + dimensions as members and a preset date range', () => {
    const scope = deriveTurnScope([
      artifact({
        measures: ['etl_money_flow.total_in'],
        dimensions: ['etl_money_flow.money_type'],
        timeDimensions: [{ dimension: 'etl_money_flow.log_date', dateRange: 'last 10 days' }],
      }),
    ]);
    expect(scope).not.toBeNull();
    expect(scope!.members).toEqual(['etl_money_flow.total_in', 'etl_money_flow.money_type']);
    expect(scope!.dateRange).toBe('last 10 days');
    expect(scope!.hiddenMemberCount).toBe(0);
    expect(scope!.extraArtifacts).toBe(0);
  });

  it('formats a [start, end] ISO tuple date range compactly', () => {
    const scope = deriveTurnScope([
      artifact({
        measures: ['mf_users.dau'],
        timeDimensions: [{ dimension: 'd', dateRange: ['2026-06-01', '2026-06-30'] }],
      }),
    ]);
    expect(scope!.dateRange).toMatch(/Jun/);
    expect(scope!.dateRange).toContain('–');
  });

  it('caps displayed members at 4 and reports the hidden count', () => {
    const scope = deriveTurnScope([
      artifact({
        measures: ['c.m1', 'c.m2', 'c.m3'],
        dimensions: ['c.d1', 'c.d2', 'c.d3'],
      }),
    ]);
    expect(scope!.members).toHaveLength(4);
    expect(scope!.hiddenMemberCount).toBe(2);
  });

  it('counts extra artifacts beyond the primary as +N', () => {
    const scope = deriveTurnScope([
      artifact({ measures: ['c.m1'] }),
      artifact({ measures: ['c.m2'] }, { id: 'a2' }),
      artifact({ measures: ['c.m3'] }, { id: 'a3' }),
    ]);
    expect(scope!.extraArtifacts).toBe(2);
  });

  it('suppresses the badge when an artifact carries neither members nor a date', () => {
    expect(deriveTurnScope([artifact({ filters: [] })])).toBeNull();
  });

  it('tolerates an off-shape / non-object query without throwing', () => {
    expect(deriveTurnScope([artifact(null)])).toBeNull();
    expect(deriveTurnScope([artifact('nonsense')])).toBeNull();
    expect(deriveTurnScope([artifact({ measures: 'not-an-array' })])).toBeNull();
  });
});
