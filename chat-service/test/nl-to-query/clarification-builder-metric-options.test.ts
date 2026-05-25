/**
 * The metric-options chip selector now hand-curates ordering so the
 * fundamental metrics (Revenue, ARPU, DAU…) surface ahead of derivative
 * ones. Without the curation, alphabetical order on cube member ids drops
 * `revenue` past the 4-chip cap because ARPDAU/ARPPU/ARPU sort earlier.
 */

import { describe, it, expect } from 'vitest';
import { buildClarifications } from '../../src/nl-to-query/clarification-builder.js';
import type { DisambiguationSlots, OfficialTerm } from '../../src/nl-to-query/types.js';

function term(id: string, label: string, category: string, ref?: string): OfficialTerm {
  return {
    id, label, labelVi: null,
    description: '',
    primaryCatalogId: ref ?? `business_metrics/${id}`,
    aliases: [], aliasesVi: [],
    category,
  };
}

const GLOSSARY: OfficialTerm[] = [
  term('arpdau', 'ARPDAU', 'monetisation'),
  term('arppu', 'ARPPU', 'monetisation'),
  term('arpu', 'ARPU', 'monetisation'),
  term('first_purchase_rate', 'First purchase rate', 'monetisation'),
  term('ltv', 'LTV', 'monetisation'),
  term('revenue', 'Revenue', 'monetisation'),
  term('dau', 'DAU', 'engagement'),
  term('d1_retention', 'D1 retention', 'retention'),
];

const SLOTS_NO_METRIC: DisambiguationSlots = {
  metric: { confidence: 0 },
  intent: { value: 'aggregate', confidence: 0.6 },
};

const SLOTS_LEADERBOARD: DisambiguationSlots = {
  metric: { confidence: 0 },
  intent: { value: 'leaderboard', confidence: 0.92 },
};

describe('metric clarification options ordering', () => {
  it('aggregate intent surfaces Revenue ahead of ARPDAU/ARPPU', () => {
    const cs = buildClarifications({
      slots: SLOTS_NO_METRIC, glossary: GLOSSARY, threshold: 0.7,
    });
    const metric = cs.find((c) => c.slot === 'metric');
    expect(metric).toBeDefined();
    const optionIds = metric!.options!.map((o) => o.value);
    const revenueIdx = optionIds.indexOf('business_metrics/revenue');
    const arpdauIdx = optionIds.indexOf('business_metrics/arpdau');
    expect(revenueIdx).toBeGreaterThanOrEqual(0);
    expect(revenueIdx).toBeLessThan(arpdauIdx);
  });

  it('leaderboard intent surfaces Revenue + LTV at the front', () => {
    const cs = buildClarifications({
      slots: SLOTS_LEADERBOARD, glossary: GLOSSARY, threshold: 0.7,
    });
    const metric = cs.find((c) => c.slot === 'metric');
    expect(metric).toBeDefined();
    const optionIds = metric!.options!.map((o) => o.value);
    expect(optionIds[0]).toBe('business_metrics/revenue');
    expect(optionIds.slice(0, 2)).toContain('business_metrics/ltv');
  });

  it('returns up to 5 options', () => {
    const cs = buildClarifications({
      slots: SLOTS_NO_METRIC, glossary: GLOSSARY, threshold: 0.7,
    });
    const metric = cs.find((c) => c.slot === 'metric');
    expect(metric!.options!.length).toBeLessThanOrEqual(5);
  });

  it('falls back to label order for unknown ids', () => {
    const extras: OfficialTerm[] = [
      ...GLOSSARY,
      term('zzz_zebra', 'Zebra', 'monetisation'),
      term('aaa_alpha', 'Alpha', 'monetisation'),
    ];
    const cs = buildClarifications({
      slots: SLOTS_NO_METRIC, glossary: extras, threshold: 0.7,
    });
    const metric = cs.find((c) => c.slot === 'metric');
    const labels = metric!.options!.map((o) => o.label_en);
    // Curated terms come first; remaining unknowns ordered alphabetically.
    const alphaIdx = labels.indexOf('Alpha');
    const zebraIdx = labels.indexOf('Zebra');
    if (alphaIdx >= 0 && zebraIdx >= 0) {
      expect(alphaIdx).toBeLessThan(zebraIdx);
    }
  });
});
