import { describe, it, expect } from 'vitest';
import { resolveTerms } from '../../src/nl-to-query/synonym-resolver.js';
import type { OfficialTerm } from '../../src/nl-to-query/types.js';

const G: OfficialTerm[] = [
  {
    id: 'paying_user', label: 'Paying user', labelVi: 'Người dùng trả phí',
    description: '', primaryCatalogId: 'mf_users.paying_users',
    aliases: ['paying user', 'payer'], aliasesVi: ['người dùng trả phí', 'payer'], category: 'user',
  },
  {
    id: 'user', label: 'User', labelVi: null,
    description: '', primaryCatalogId: 'mf_users.users',
    aliases: ['user'], aliasesVi: [], category: 'user',
  },
  {
    id: 'revenue', label: 'Revenue', labelVi: 'Doanh thu',
    description: '', primaryCatalogId: 'business_metrics.revenue',
    aliases: ['revenue'], aliasesVi: ['doanh thu'], category: 'monetisation',
  },
];

describe('synonym-resolver', () => {
  it('longest-match wins on "paying user" vs "user"', () => {
    const hits = resolveTerms('số lượng paying user', G);
    const termIds = hits.map((h) => h.termId);
    expect(termIds).toContain('paying_user');
    expect(termIds).not.toContain('user');
  });

  it('matches VI alias "doanh thu"', () => {
    const hits = resolveTerms('Doanh thu tháng trước', G);
    expect(hits[0]?.termId).toBe('revenue');
    expect(hits[0]?.cubeRef).toBe('business_metrics.revenue');
  });

  it('respects word boundary — does not match inside "users"', () => {
    const hits = resolveTerms('users abc', G);
    expect(hits.find((h) => h.termId === 'user')).toBeUndefined();
  });

  it('returns empty array when no aliases match', () => {
    const hits = resolveTerms('totally unrelated text', G);
    expect(hits).toEqual([]);
  });
});
