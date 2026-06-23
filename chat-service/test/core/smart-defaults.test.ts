/**
 * Unit tests for the smart-default policy (P3): per-game revenue default
 * resolution + the rendered "answer, don't ask" guidance.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveRevenueDefault,
  renderSmartDefaults,
  resolveActiveUserDefault,
  messageHasMoneyCue,
  resolveDefaultMetric,
} from '../../src/core/smart-defaults.js';
import type { OfficialTerm } from '../../src/nl-to-query/types.js';

function term(p: Partial<OfficialTerm> & { id: string }): OfficialTerm {
  return {
    label: p.id,
    description: '',
    primaryCatalogId: null,
    aliases: [],
    aliasesVi: [],
    labelVi: null,
    category: null,
    measureRef: null,
    ratioRef: null,
    refKind: 'measure',
    entityCube: null,
    entityPk: null,
    ...p,
  } as OfficialTerm;
}

describe('resolveRevenueDefault', () => {
  it('prefers an explicit revenue concept with a measure ref', () => {
    const g = [
      term({ id: 'arpu', refKind: 'ratio', category: 'monetisation', label: 'ARPU' }),
      term({ id: 'revenue', measureRef: 'recharge.revenue_vnd', label: 'Revenue', category: 'revenue' }),
    ];
    expect(resolveRevenueDefault(g)).toEqual({ ref: 'recharge.revenue_vnd', label: 'Revenue' });
  });

  it('falls back to the first revenue-category measure term', () => {
    const g = [
      term({ id: 'gross_recharge', measureRef: 'recharge.gross_vnd', label: 'Gross recharge', category: 'Revenue' }),
    ];
    expect(resolveRevenueDefault(g)).toEqual({ ref: 'recharge.gross_vnd', label: 'Gross recharge' });
  });

  it('never picks a ratio term as the revenue default', () => {
    const g = [term({ id: 'revenue', refKind: 'ratio', ratioRef: 'a/b', category: 'revenue', label: 'Revenue' })];
    expect(resolveRevenueDefault(g)).toBeNull();
  });

  it('returns null when no revenue measure exists', () => {
    const g = [term({ id: 'dau', measureRef: 'active.dau', category: 'engagement', label: 'DAU' })];
    expect(resolveRevenueDefault(g)).toBeNull();
  });
});

describe('resolveActiveUserDefault', () => {
  it('resolves the canonical active-user concept', () => {
    const g = [
      term({ id: 'active-user', measureRef: 'active_daily.dau', label: 'Active Users', category: 'engagement' }),
    ];
    expect(resolveActiveUserDefault(g)).toEqual({ ref: 'active_daily.dau', label: 'Active Users' });
  });
  it('falls back to any measure term whose ref leaf is dau', () => {
    const g = [term({ id: 'engagement_dau', measureRef: 'active_daily.dau', label: 'DAU', category: 'engagement' })];
    expect(resolveActiveUserDefault(g)).toEqual({ ref: 'active_daily.dau', label: 'DAU' });
  });
  it('returns null when no active-user measure exists', () => {
    expect(resolveActiveUserDefault([term({ id: 'revenue', measureRef: 'recharge.revenue_vnd', label: 'Revenue' })])).toBeNull();
  });
});

describe('messageHasMoneyCue', () => {
  it.each(['Whale revenue', 'how much did they spend', 'ARPU last week', 'paid users', 'gross VND'])(
    'detects money cue in "%s"', (m) => expect(messageHasMoneyCue(m)).toBe(true),
  );
  it.each(['show Minnow last 7 days', 'Whale this month', 'compare Dolphin month over month'])(
    'no money cue in "%s"', (m) => expect(messageHasMoneyCue(m)).toBe(false),
  );
  it('does not trip on "player" (word-boundary)', () => {
    expect(messageHasMoneyCue('top players by region')).toBe(false);
  });
});

describe('resolveDefaultMetric', () => {
  const g = [
    term({ id: 'active-user', measureRef: 'active_daily.dau', label: 'Active Users', category: 'engagement' }),
    term({ id: 'revenue', measureRef: 'user_recharge_daily.revenue_vnd_total', label: 'Revenue', category: 'monetisation' }),
  ];
  it('money cue → Revenue', () => {
    expect(resolveDefaultMetric(g, 'Whale revenue this month')?.ref).toBe('user_recharge_daily.revenue_vnd_total');
  });
  it('no money cue → active-user count', () => {
    expect(resolveDefaultMetric(g, 'show Minnow last 7 days')?.ref).toBe('active_daily.dau');
  });
  it('falls back to revenue when no active-user measure exists', () => {
    const gNoDau = [term({ id: 'revenue', measureRef: 'recharge.revenue_vnd', label: 'Revenue', category: 'monetisation' })];
    expect(resolveDefaultMetric(gNoDau, 'show Minnow')?.ref).toBe('recharge.revenue_vnd');
  });
});

describe('renderSmartDefaults', () => {
  it('defaults metric to the resolved revenue measure when present', () => {
    const text = renderSmartDefaults({ ref: 'recharge.revenue_vnd', label: 'Revenue' });
    expect(text).toContain('## Smart defaults');
    expect(text).toContain('{{field:recharge.revenue_vnd}}');
    expect(text).toContain('last 30 days');
    expect(text).toContain('HIGH-IMPACT');
    expect(text).toContain('grain');
  });

  it('makes metric ask-first when no revenue measure resolves', () => {
    const text = renderSmartDefaults(null);
    expect(text).toContain('no resolvable Revenue measure');
    expect(text).not.toContain('{{field:');
  });
});
