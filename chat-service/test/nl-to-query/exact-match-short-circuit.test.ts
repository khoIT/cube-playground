import { describe, it, expect } from 'vitest';
import { findExactMatch } from '../../src/nl-to-query/synonym-resolver.js';
import type { OfficialTerm } from '../../src/nl-to-query/types.js';

function term(overrides: Partial<OfficialTerm>): OfficialTerm {
  return {
    id: overrides.id ?? 'x',
    label: overrides.label ?? 'X',
    description: '',
    primaryCatalogId: overrides.primaryCatalogId ?? null,
    aliases: overrides.aliases ?? [],
    aliasesVi: overrides.aliasesVi ?? [],
    labelVi: overrides.labelVi ?? null,
    category: overrides.category ?? null,
  };
}

const DAU = term({
  id: 'dau',
  label: 'DAU',
  aliases: ['dau', 'daily active users'],
});

const REVENUE = term({
  id: 'revenue',
  label: 'Revenue',
  aliases: ['revenue', 'total revenue', 'gross'],
  labelVi: 'Doanh thu',
  aliasesVi: ['doanh thu'],
});

const SPENDER = term({
  id: 'spender',
  label: 'Spender',
  aliases: ['spender', 'spenders'],
});

const GLOSSARY = [DAU, REVENUE, SPENDER];

describe('findExactMatch', () => {
  it('matches by id (case-insensitive)', () => {
    expect(findExactMatch('DAU', GLOSSARY)?.matchedOn).toBe('id');
    expect(findExactMatch('dau', GLOSSARY)?.termId).toBe('dau');
  });

  it('matches by label (case + trim) when label differs from id', () => {
    const longTerm = term({ id: 'rolling-7d', label: 'Rolling 7d', aliases: [] });
    const m = findExactMatch('  Rolling 7d ', [longTerm]);
    expect(m?.termId).toBe('rolling-7d');
    expect(m?.matchedOn).toBe('label');
  });

  it('matches by alias', () => {
    const m = findExactMatch('spenders', GLOSSARY);
    expect(m?.termId).toBe('spender');
    expect(m?.matchedOn).toBe('alias');
  });

  it('matches by VI label', () => {
    const m = findExactMatch('Doanh thu', GLOSSARY);
    expect(m?.termId).toBe('revenue');
    expect(m?.matchedOn).toBe('label');
  });

  it('returns null when no exact match', () => {
    expect(findExactMatch('top spenders this week', GLOSSARY)).toBeNull();
    expect(findExactMatch('', GLOSSARY)).toBeNull();
    expect(findExactMatch('  ', GLOSSARY)).toBeNull();
  });

  it('returns null when two distinct terms share the same alias (ambiguous)', () => {
    const collisionA = term({ id: 'a', aliases: ['active'] });
    const collisionB = term({ id: 'b', aliases: ['active'] });
    expect(findExactMatch('active', [collisionA, collisionB])).toBeNull();
  });
});
