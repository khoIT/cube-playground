/**
 * Unit tests for the smart-default policy (P3): per-game revenue default
 * resolution + the rendered "answer, don't ask" guidance.
 */

import { describe, it, expect } from 'vitest';
import { resolveRevenueDefault, renderSmartDefaults } from '../../src/core/smart-defaults.js';
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
