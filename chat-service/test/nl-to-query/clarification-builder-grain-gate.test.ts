/**
 * Grain gate (P5): ratio metrics (per-head averages like ARPU/ARPDAU/ARPPU)
 * must never be offered to rank INDIVIDUALS, but stay valid for GROUP rankings
 * (top countries by ARPU). Enforced in code, not just prompt guidance — gated
 * by `gateIndividualRatios` so default-off keeps prior behavior.
 */

import { describe, it, expect } from 'vitest';
import { buildClarifications } from '../../src/nl-to-query/clarification-builder.js';
import type { DisambiguationSlots, OfficialTerm } from '../../src/nl-to-query/types.js';

function term(id: string, label: string, refKind: OfficialTerm['refKind']): OfficialTerm {
  return {
    id,
    label,
    labelVi: null,
    description: '',
    primaryCatalogId: `business_metrics/${id}`,
    aliases: [],
    aliasesVi: [],
    category: 'monetisation',
    measureRef: `m.${id}`,
    ratioRef: refKind === 'ratio' ? `n.${id}/d.${id}` : null,
    refKind,
  } as OfficialTerm;
}

const GLOSSARY: OfficialTerm[] = [
  term('revenue', 'Revenue', 'measure'),
  term('ltv', 'LTV', 'measure'),
  term('arpu', 'ARPU', 'ratio'),
  term('arpdau', 'ARPDAU', 'ratio'),
  term('arppu', 'ARPPU', 'ratio'),
];

function leaderboardSlots(entity?: { cube: string; pk: string }): DisambiguationSlots {
  return {
    metric: { confidence: 0 },
    intent: { value: 'leaderboard', confidence: 0.92 },
    entity: entity ? { value: entity, confidence: 0.95 } : undefined,
  };
}

const optionIds = (cs: ReturnType<typeof buildClarifications>) =>
  cs.find((c) => c.slot === 'metric')?.options?.map((o) => o.value) ?? [];

describe('grain gate — ranking individuals', () => {
  const individual = { cube: 'mf_users', pk: 'user_id' };

  it('drops ratio metrics for an individual ranking when the gate is on', () => {
    const ids = optionIds(
      buildClarifications({ slots: leaderboardSlots(individual), glossary: GLOSSARY, threshold: 0.7, gateIndividualRatios: true }),
    );
    expect(ids).toContain('m.revenue');
    expect(ids).toContain('m.ltv');
    expect(ids).not.toContain('m.arpu');
    expect(ids).not.toContain('m.arpdau');
    expect(ids).not.toContain('m.arppu');
  });

  it('keeps ratio metrics for an individual when the gate is OFF (no behavior change)', () => {
    const ids = optionIds(
      buildClarifications({ slots: leaderboardSlots(individual), glossary: GLOSSARY, threshold: 0.7 }),
    );
    expect(ids).toContain('m.arpu');
  });
});

describe('grain gate — ranking groups', () => {
  it('keeps ratio metrics for a group ranking even with the gate on', () => {
    const ids = optionIds(
      buildClarifications({
        slots: leaderboardSlots({ cube: 'geo', pk: 'country' }),
        glossary: GLOSSARY,
        threshold: 0.7,
        gateIndividualRatios: true,
      }),
    );
    expect(ids).toContain('m.arpu'); // top countries by ARPU is valid
    expect(ids).toContain('m.revenue');
  });

  it('keeps ratio metrics when the grain is unknown (no entity) even with the gate on', () => {
    const ids = optionIds(
      buildClarifications({ slots: leaderboardSlots(), glossary: GLOSSARY, threshold: 0.7, gateIndividualRatios: true }),
    );
    expect(ids).toContain('m.arpu');
  });

  it('treats a vopenid / role pk as individual grain', () => {
    const ids = optionIds(
      buildClarifications({
        slots: leaderboardSlots({ cube: 'etl_login', pk: 'vopenid' }),
        glossary: GLOSSARY,
        threshold: 0.7,
        gateIndividualRatios: true,
      }),
    );
    expect(ids).not.toContain('m.arpu');
  });
});
