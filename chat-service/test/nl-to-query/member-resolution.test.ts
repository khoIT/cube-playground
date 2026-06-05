/**
 * Unit tests for the NL → physical-member resolver.
 * Pure: synthetic glossary + synthetic /meta, no network.
 */

import { describe, it, expect } from 'vitest';
import { searchMembers, resolveTerm, resolveQueryTerms } from '../../src/nl-to-query/member-resolution.js';
import type { OfficialTerm } from '../../src/nl-to-query/types.js';

// Mirrors the real Cube /meta shape (cubes[].measures/dimensions[].name/title/type).
const META = {
  cubes: [
    {
      name: 'recharge',
      measures: [{ name: 'recharge.revenue_vnd', title: 'Revenue (VND)', type: 'number' }],
      dimensions: [
        { name: 'recharge.recharge_date', type: 'time', title: 'Recharge date' },
        { name: 'recharge.channel', type: 'string', title: 'Channel' },
      ],
    },
    {
      name: 'mf_users',
      measures: [
        { name: 'mf_users.count', type: 'number' },
        { name: 'mf_users.ltv_total_vnd', shortTitle: 'Total LTV (VND)', title: 'mf_users Total LTV' },
      ],
      dimensions: [
        { name: 'mf_users.user_id', type: 'string', title: 'User ID' },
        { name: 'mf_users.payer_tier', type: 'string', title: 'Payer tier' },
        { name: 'mf_users.days_since_last_active', type: 'number', title: 'Days since last active' },
      ],
    },
  ],
};

// Minimal glossary: one business metric term ("revenue") wired to a cube member.
function term(partial: Partial<OfficialTerm> & { id: string; label: string }): OfficialTerm {
  return {
    description: '',
    primaryCatalogId: null,
    aliases: [],
    aliasesVi: [],
    labelVi: null,
    category: null,
    ...partial,
  } as OfficialTerm;
}

const GLOSSARY: OfficialTerm[] = [
  term({ id: 'revenue', label: 'Revenue', aliases: ['revenue', 'doanh thu'], measureRef: 'recharge.revenue_vnd' }),
];

describe('searchMembers', () => {
  it('resolves a member-leaf term to its physical ref', () => {
    const hits = searchMembers(META, 'user id');
    expect(hits[0].member).toBe('mf_users.user_id');
    expect(hits[0].kind).toBe('dimension');
    expect(hits[0].dataType).toBe('string');
    expect(hits[0].label).toBe('User ID');
  });

  it('resolves a time dimension and classifies it as time', () => {
    const hits = searchMembers(META, 'recharge date');
    expect(hits[0].member).toBe('recharge.recharge_date');
    expect(hits[0].kind).toBe('timeDimension');
    expect(hits[0].dataType).toBe('time');
  });

  it('matches on title tokens when the leaf differs', () => {
    const hits = searchMembers(META, 'days since last active');
    expect(hits[0].member).toBe('mf_users.days_since_last_active');
    expect(hits[0].dataType).toBe('number');
  });

  it('returns [] for a term with no overlap', () => {
    expect(searchMembers(META, 'zzz nonexistent')).toEqual([]);
  });

  it('honours the topK cap', () => {
    expect(searchMembers(META, 'user', 1).length).toBeLessThanOrEqual(1);
  });
});

describe('resolveTerm', () => {
  it('resolves a business metric via the glossary at top confidence', () => {
    const matches = resolveTerm('revenue', GLOSSARY, META);
    expect(matches[0].member).toBe('recharge.revenue_vnd');
    expect(matches[0].matchedOn).toBe('glossary-exact');
    expect(matches[0].confidence).toBe(1);
  });

  it('resolves a structural member the glossary does not hold', () => {
    const matches = resolveTerm('user id', GLOSSARY, META);
    expect(matches[0].member).toBe('mf_users.user_id');
    expect(matches[0].matchedOn).toBe('meta-name');
  });

  it('dedupes a member found by both glossary and meta, keeping highest confidence', () => {
    // "revenue" hits the glossary (conf 1.0) and also the meta title — one entry.
    const matches = resolveTerm('revenue', GLOSSARY, META);
    const revenueEntries = matches.filter((m) => m.member === 'recharge.revenue_vnd');
    expect(revenueEntries).toHaveLength(1);
    expect(revenueEntries[0].confidence).toBe(1);
  });
});

describe('resolveQueryTerms', () => {
  it('resolves a batch and never throws on unknown terms', () => {
    const out = resolveQueryTerms(['user id', 'revenue', 'totally unknown thing'], GLOSSARY, META);
    expect(out).toHaveLength(3);
    expect(out[0].matches[0].member).toBe('mf_users.user_id');
    expect(out[1].matches[0].member).toBe('recharge.revenue_vnd');
    expect(out[2].matches).toEqual([]);
  });

  it('resolves all four whale-turn terms in one pass', () => {
    const out = resolveQueryTerms(
      ['revenue', 'user id', 'days since last active', 'recharge date'],
      GLOSSARY,
      META,
    );
    expect(out.map((r) => r.matches[0]?.member)).toEqual([
      'recharge.revenue_vnd',
      'mf_users.user_id',
      'mf_users.days_since_last_active',
      'recharge.recharge_date',
    ]);
  });
});
