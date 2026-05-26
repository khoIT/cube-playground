import { describe, it, expect } from 'vitest';
import { resolveConcepts, pickBestConcept, resolveBestConcept, isConceptTerm } from '../../src/nl-to-query/concept-resolver.js';
import type { OfficialTerm } from '../../src/nl-to-query/types.js';

function term(overrides: Partial<OfficialTerm>): OfficialTerm {
  return {
    id: overrides.id ?? 'x',
    label: overrides.label ?? 'X',
    description: overrides.description ?? '',
    primaryCatalogId: overrides.primaryCatalogId ?? null,
    aliases: overrides.aliases ?? [],
    aliasesVi: overrides.aliasesVi ?? [],
    labelVi: overrides.labelVi ?? null,
    category: overrides.category ?? null,
    entityCube: overrides.entityCube ?? null,
    entityPk: overrides.entityPk ?? null,
    defaultMeasureRef: overrides.defaultMeasureRef ?? null,
    defaultFilter: overrides.defaultFilter ?? null,
    ranking: overrides.ranking ?? null,
    trustTier: overrides.trustTier ?? null,
  };
}

const SPENDER = term({
  id: 'spender',
  label: 'Spender',
  aliases: ['spender', 'spenders', 'payer', 'payers'],
  aliasesVi: ['người trả phí'],
  labelVi: 'Người trả phí',
  entityCube: 'players',
  entityPk: 'players.user_id',
  defaultMeasureRef: 'recharge.revenue_vnd',
  defaultFilter: { member: 'recharge.revenue_vnd', op: '>', value: 0 },
  ranking: { order: 'DESC', default_limit: 10 },
});

const WHALE = term({
  id: 'whale',
  label: 'Whale',
  aliases: ['whale', 'whales', 'high spender'],
  entityCube: 'players',
  entityPk: 'players.user_id',
  defaultMeasureRef: 'recharge.revenue_vnd',
  ranking: { order: 'DESC', default_limit: 10 },
});

const DAU_NON_CONCEPT = term({
  id: 'dau',
  label: 'DAU',
  aliases: ['dau', 'daily active users'],
});

const FIRST_TIME_PAYER = term({
  id: 'first-time-payer',
  label: 'First-time payer',
  aliases: ['first time payer', 'first-time payer', 'ftp'],
  entityCube: 'players',
  entityPk: 'players.user_id',
  defaultMeasureRef: 'recharge.revenue_vnd',
});

const GLOSSARY = [SPENDER, WHALE, DAU_NON_CONCEPT, FIRST_TIME_PAYER];

describe('isConceptTerm', () => {
  it('returns true for terms with entityCube', () => {
    expect(isConceptTerm(SPENDER)).toBe(true);
  });
  it('returns false for terms without any concept-tier field', () => {
    expect(isConceptTerm(DAU_NON_CONCEPT)).toBe(false);
  });
});

describe('resolveConcepts', () => {
  it('returns empty for empty message', () => {
    expect(resolveConcepts('', GLOSSARY)).toEqual([]);
    expect(resolveConcepts('   ', GLOSSARY)).toEqual([]);
  });

  it('exact full-message alias match scores 1.0', () => {
    const hits = resolveConcepts('spender', GLOSSARY);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ conceptId: 'spender', score: 1.0 });
  });

  it('exact match is case + trim-insensitive', () => {
    expect(resolveConcepts('  Spenders ', GLOSSARY)[0]?.score).toBe(1.0);
  });

  it('substring match inside a phrase scores 0.85', () => {
    const hits = resolveConcepts('top spenders this week', GLOSSARY);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ conceptId: 'spender', score: 0.85 });
  });

  it('does not return non-concept terms (DAU)', () => {
    const hits = resolveConcepts('dau', GLOSSARY);
    expect(hits).toEqual([]);
  });

  it('matches VI aliases', () => {
    const hits = resolveConcepts('người trả phí', GLOSSARY);
    expect(hits[0]?.conceptId).toBe('spender');
    expect(hits[0]?.lang).toBe('vi');
  });

  it('longer alias wins on tie ("first time payer" beats "ftp")', () => {
    const hits = resolveConcepts('first time payer', GLOSSARY);
    expect(hits[0]?.conceptId).toBe('first-time-payer');
    expect(hits[0]?.alias).toBe('first time payer');
  });
});

describe('pickBestConcept', () => {
  it('returns null when no hits', () => {
    expect(pickBestConcept([])).toBeNull();
  });

  it('gap defaults to 1 (clear win) when only one distinct concept hit', () => {
    const resolution = pickBestConcept(resolveConcepts('top spenders this week', GLOSSARY));
    expect(resolution).not.toBeNull();
    expect(resolution!.confidence).toBe(0.85);
    expect(resolution!.gap).toBe(1);
    expect(resolution!.secondBest).toBeNull();
  });

  it('gap reflects difference when two distinct concepts hit', () => {
    // Synthetic case: an exact concept hit + a substring sibling concept hit.
    const hits = [
      { conceptId: 'spender', term: SPENDER, alias: 'spender', span: [0, 7] as [number, number], score: 1.0, lang: 'en' as const },
      { conceptId: 'whale', term: WHALE, alias: 'whale', span: [10, 15] as [number, number], score: 0.85, lang: 'en' as const },
    ];
    const resolution = pickBestConcept(hits);
    expect(resolution!.best.conceptId).toBe('spender');
    expect(resolution!.secondBest?.conceptId).toBe('whale');
    expect(resolution!.gap).toBeCloseTo(0.15, 5);
  });
});

describe('resolveBestConcept (integration)', () => {
  it('clear leaderboard concept passes auto-route gate', () => {
    const r = resolveBestConcept('top spenders this week', GLOSSARY);
    expect(r).not.toBeNull();
    expect(r!.confidence).toBe(0.85);
    expect(r!.gap).toBe(1);
    expect(r!.best.term.entityCube).toBe('players');
    expect(r!.best.term.defaultMeasureRef).toBe('recharge.revenue_vnd');
  });

  it('exact alias short-circuit hits 1.0', () => {
    expect(resolveBestConcept('spender', GLOSSARY)?.confidence).toBe(1.0);
  });

  it('non-concept message returns null', () => {
    expect(resolveBestConcept('dau by country', GLOSSARY)).toBeNull();
  });
});
