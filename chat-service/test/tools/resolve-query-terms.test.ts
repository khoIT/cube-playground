/**
 * Tool test for resolve_query_terms — verifies it wires the glossary + live
 * /meta into the resolver engine and shapes the result. Mocks the glossary
 * fetch and the meta cache so it stays offline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OfficialTerm } from '../../src/nl-to-query/types.js';

const META = {
  cubes: [
    {
      name: 'mf_users',
      measures: [{ name: 'mf_users.ltv_total_vnd', shortTitle: 'Total LTV (VND)' }],
      dimensions: [{ name: 'mf_users.user_id', type: 'string', title: 'User ID' }],
    },
  ],
};

function term(partial: Partial<OfficialTerm> & { id: string; label: string }): OfficialTerm {
  return {
    description: '', primaryCatalogId: null, aliases: [], aliasesVi: [],
    labelVi: null, category: null, ...partial,
  } as OfficialTerm;
}

const GLOSSARY: OfficialTerm[] = [
  term({ id: 'ltv', label: 'Lifetime value', aliases: ['ltv', 'lifetime value'], measureRef: 'mf_users.ltv_total_vnd' }),
];

vi.mock('../../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn(async () => META),
}));
vi.mock('../../src/nl-to-query/glossary-client.js', () => ({
  fetchOfficialGlossary: vi.fn(async () => GLOSSARY),
}));

import { handler } from '../../src/tools/resolve-query-terms.js';
import type { ToolContext } from '../../src/types.js';

const ctx = { gameId: 'g1', workspace: 'local' } as unknown as ToolContext;

describe('resolve_query_terms tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves terms against glossary + meta', async () => {
    const out = (await handler({ terms: ['ltv', 'user id'] }, ctx)) as {
      results: Array<{ term: string; matches: Array<{ member: string; matchedOn: string }> }>;
    };
    expect(out.results[0].matches[0].member).toBe('mf_users.ltv_total_vnd');
    expect(out.results[0].matches[0].matchedOn).toBe('glossary-exact');
    expect(out.results[1].matches[0].member).toBe('mf_users.user_id');
  });

  it('tolerates a glossary fetch failure (falls back to meta-only)', async () => {
    const gc = await import('../../src/nl-to-query/glossary-client.js');
    (gc.fetchOfficialGlossary as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    const out = (await handler({ terms: ['user id'] }, ctx)) as {
      results: Array<{ matches: Array<{ member: string }> }>;
    };
    expect(out.results[0].matches[0].member).toBe('mf_users.user_id');
  });
});
