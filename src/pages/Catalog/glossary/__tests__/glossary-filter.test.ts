import { describe, it, expect } from 'vitest';
import { filterGlossaryTerms, wiringFacetOf } from '../glossary-filter';
import type { GlossaryStatus, GlossaryTerm } from '../../../../api/glossary-client';
import type { WiringFacet } from '../glossary-filter';

function term(over: Partial<GlossaryTerm>): GlossaryTerm {
  return {
    id: over.id ?? 'x',
    label: over.label ?? 'X',
    description: over.description ?? '',
    labelVi: null,
    descriptionVi: null,
    primaryCatalogId: null,
    secondaryCatalogIds: [],
    category: over.category ?? null,
    aliases: over.aliases ?? [],
    aliasesVi: over.aliasesVi ?? [],
    status: over.status ?? 'draft',
    source: 'seed',
    editorName: null,
    entityCube: over.entityCube ?? null,
    entityPk: null,
    defaultMeasureRef: over.defaultMeasureRef ?? null,
    defaultFilter: null,
    ranking: null,
    trustTier: null,
    trust: 'draft',
    visibility: 'org',
    ...over,
  } as GlossaryTerm;
}

const WIRED = term({ id: 'whale', label: 'Whale', category: 'segments', status: 'official', defaultMeasureRef: 'mf_users.user_count' });
const WIRED_DRAFT = term({ id: 'dau', label: 'DAU', category: 'engagement', status: 'draft', entityCube: 'mf_users' });
// Metric-linked: binds via primaryCatalogId (not concept-tier fields) yet still
// resolves to live data — must classify as wired.
const METRIC_LINKED = term({ id: 'arpu', label: 'ARPU', category: 'monetisation', status: 'official', primaryCatalogId: 'business_metrics/arpu' });
const MEMBER_LINKED = term({ id: 'country', label: 'Country', category: 'user', primaryCatalogId: 'mf_users.country' });
const DEF = term({ id: 'cohort', label: 'Cohort', category: 'concepts', status: 'draft' }); // prose-only: no binding at all

const ALL = [WIRED, WIRED_DRAFT, METRIC_LINKED, DEF];

function crit(over: Partial<Parameters<typeof filterGlossaryTerms>[1]> = {}) {
  return {
    query: '',
    statuses: new Set<GlossaryStatus>(),
    wiring: new Set<WiringFacet>(),
    categories: new Set<string>(),
    ...over,
  };
}

describe('wiringFacetOf', () => {
  it('classifies a term with a data binding as wired', () => {
    expect(wiringFacetOf(WIRED)).toBe('wired'); // defaultMeasureRef
    expect(wiringFacetOf(WIRED_DRAFT)).toBe('wired'); // entityCube
  });
  it('classifies a prose-only term as definition', () => {
    expect(wiringFacetOf(DEF)).toBe('definition');
  });
  it('counts a primaryCatalogId metric/member link as wired', () => {
    expect(wiringFacetOf(METRIC_LINKED)).toBe('wired'); // business_metrics/arpu
    expect(wiringFacetOf(MEMBER_LINKED)).toBe('wired'); // mf_users.country
  });
});

describe('filterGlossaryTerms', () => {
  it('empty criteria returns everything (each axis empty = no constraint)', () => {
    expect(filterGlossaryTerms(ALL, crit())).toHaveLength(4);
  });

  it('status axis keeps only matching statuses', () => {
    const out = filterGlossaryTerms(ALL, crit({ statuses: new Set<GlossaryStatus>(['official']) }));
    expect(out.map((t) => t.id).sort()).toEqual(['arpu', 'whale']);
  });

  it('wiring axis splits wired (incl. metric-linked) from definition-only', () => {
    const wired = filterGlossaryTerms(ALL, crit({ wiring: new Set<WiringFacet>(['wired']) }));
    expect(wired.map((t) => t.id).sort()).toEqual(['arpu', 'dau', 'whale']);
    const def = filterGlossaryTerms(ALL, crit({ wiring: new Set<WiringFacet>(['definition']) }));
    expect(def.map((t) => t.id)).toEqual(['cohort']);
  });

  it('category axis is OR within the axis', () => {
    const out = filterGlossaryTerms(ALL, crit({ categories: new Set(['segments', 'monetisation']) }));
    expect(out.map((t) => t.id).sort()).toEqual(['arpu', 'whale']);
  });

  it('axes combine with AND', () => {
    // wired AND draft → only dau (whale & arpu are wired but official; cohort is draft but definition)
    const out = filterGlossaryTerms(
      ALL,
      crit({ wiring: new Set<WiringFacet>(['wired']), statuses: new Set<GlossaryStatus>(['draft']) }),
    );
    expect(out.map((t) => t.id)).toEqual(['dau']);
  });

  it('free-text search matches label and is case-insensitive', () => {
    expect(filterGlossaryTerms(ALL, crit({ query: 'whal' })).map((t) => t.id)).toEqual(['whale']);
    expect(filterGlossaryTerms(ALL, crit({ query: 'ARPU' })).map((t) => t.id)).toEqual(['arpu']);
  });

  it('search matches aliases', () => {
    const aliased = term({ id: 'k', label: 'Konglomerat', aliases: ['biggie'], category: 'user' });
    expect(filterGlossaryTerms([aliased], crit({ query: 'biggie' }))).toHaveLength(1);
  });
});
