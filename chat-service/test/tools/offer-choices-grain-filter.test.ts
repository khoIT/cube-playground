/**
 * Free-form grain gate (P5 follow-up): the offer_choices filter that strips
 * ratio-metric chips when ranking an individual entity — the same rule the
 * deterministic engine applies, extended to the path the engine doesn't own.
 */

import { describe, it, expect } from 'vitest';
import { ratioLabelSet, filterIndividualRatioOptions } from '../../src/tools/offer-choices-grain-filter.js';
import type { OfficialTerm } from '../../src/nl-to-query/types.js';

function term(id: string, label: string, refKind: OfficialTerm['refKind'], aliases: string[] = []): OfficialTerm {
  return {
    id, label, labelVi: null, description: '', primaryCatalogId: null,
    aliases, aliasesVi: [], category: 'monetisation',
    measureRef: refKind === 'measure' ? `m.${id}` : null,
    ratioRef: refKind === 'ratio' ? `n/d` : null, refKind,
  } as OfficialTerm;
}

const GLOSSARY: OfficialTerm[] = [
  term('revenue', 'Revenue', 'measure'),
  term('arpu', 'ARPU', 'measure'), // on this game ARPU is a per-user measure → NOT a ratio → kept
  term('arpdau', 'ARPDAU', 'ratio'),
  term('arppu', 'ARPPU', 'ratio'),
  term('ltv', 'LTV', 'ratio', ['lifetime value']),
  term('d7_retention', 'D7 retention', 'ratio', ['retention rate']),
];

const RATIOS = ratioLabelSet(GLOSSARY);

const opt = (label: string) => ({ label, pinText: `Rank the top players by ${label}.` });

describe('ratioLabelSet', () => {
  it('collects only ratio-kind term labels/aliases (normalised)', () => {
    expect(RATIOS.has('arpdau')).toBe(true);
    expect(RATIOS.has('arppu')).toBe(true);
    expect(RATIOS.has('ltv')).toBe(true);
    expect(RATIOS.has('lifetime value')).toBe(true);
    expect(RATIOS.has('revenue')).toBe(false);
    expect(RATIOS.has('arpu')).toBe(false); // measure here, not a ratio
  });
});

describe('filterIndividualRatioOptions', () => {
  it('drops ratio chips for an individual ranking, keeps measures', () => {
    const r = filterIndividualRatioOptions(
      [opt('Revenue'), opt('LTV'), opt('ARPDAU'), opt('ARPU')],
      true,
      RATIOS,
    );
    const labels = r.options.map((o) => o.label);
    expect(labels).toEqual(['Revenue', 'ARPU']);
    expect(r.dropped.sort()).toEqual(['ARPDAU', 'LTV']);
  });

  it('matches a ratio inside a decorated label ("LTV (lifetime value)")', () => {
    const r = filterIndividualRatioOptions([opt('Revenue'), opt('Sessions'), opt('LTV (lifetime value)')], true, RATIOS);
    expect(r.dropped).toEqual(['LTV (lifetime value)']);
    expect(r.options.map((o) => o.label)).toEqual(['Revenue', 'Sessions']);
  });

  it('is a no-op when the entity is not individual (group ranking keeps ratios)', () => {
    const opts = [opt('Revenue'), opt('ARPDAU')];
    const r = filterIndividualRatioOptions(opts, false, RATIOS);
    expect(r.options).toBe(opts);
    expect(r.dropped).toEqual([]);
  });

  it('never strips below two options — keeps the set intact instead', () => {
    // Both options are ratios; dropping leaves <2 → keep all.
    const opts = [opt('LTV'), opt('ARPDAU')];
    const r = filterIndividualRatioOptions(opts, true, RATIOS);
    expect(r.options).toBe(opts);
    expect(r.dropped).toEqual([]);
  });

  it('catches a decorated multi-word ratio label via phrase substring', () => {
    const r = filterIndividualRatioOptions(
      [opt('Revenue'), opt('Sessions'), opt('D7 retention rate')],
      true,
      RATIOS,
    );
    expect(r.dropped).toEqual(['D7 retention rate']);
    expect(r.options.map((o) => o.label)).toEqual(['Revenue', 'Sessions']);
  });

  it('is a no-op when nothing matches a ratio', () => {
    const opts = [opt('Revenue'), opt('Sessions'), opt('Playtime')];
    const r = filterIndividualRatioOptions(opts, true, RATIOS);
    expect(r.options).toBe(opts);
    expect(r.dropped).toEqual([]);
  });
});
