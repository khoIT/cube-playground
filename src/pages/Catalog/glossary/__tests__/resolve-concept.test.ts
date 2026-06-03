import { describe, it, expect } from 'vitest';
import { resolveConceptHref, conceptTypedActions, toConceptRef } from '../resolve-concept';

describe('toConceptRef — canonical namespaced ref for relations', () => {
  it('passes through an already-namespaced primaryCatalogId', () => {
    expect(toConceptRef({ id: 'dau', primaryCatalogId: 'business_metrics/dau' })).toBe('business_metrics/dau');
  });
  it('namespaces a bare cube-member primaryCatalogId as data_model', () => {
    expect(toConceptRef({ id: 'country', primaryCatalogId: 'mf_users.country' })).toBe('data_model/mf_users.country');
  });
  it('derives data_model ref from a filter-only term (payer tiers)', () => {
    expect(
      toConceptRef({
        id: 'whale',
        primaryCatalogId: null,
        defaultFilter: { member: 'mf_users.payer_tier', op: '=', value: 'whale' },
      }),
    ).toBe('data_model/mf_users.payer_tier');
  });
  it('falls back to defaultMeasureRef, else null', () => {
    expect(toConceptRef({ id: 'x', primaryCatalogId: null, defaultMeasureRef: 'mf_users.user_count' })).toBe('data_model/mf_users.user_count');
    expect(toConceptRef({ id: 'plain', primaryCatalogId: null })).toBeNull();
  });
});

// ─── resolveConceptHref ───────────────────────────────────────────────────────
// This is a thin re-export of resolveGlossaryHref; the routing rules are fully
// tested in resolve-glossary-link.test.ts.  We only verify the critical
// invariants required by this phase: correct destinations and NEVER the bare
// index root.

describe('resolveConceptHref', () => {
  it('routes a business_metrics term to /catalog/metric/<slug>', () => {
    expect(
      resolveConceptHref({ id: 'dau', primaryCatalogId: 'business_metrics/dau' }),
    ).toBe('/catalog/metric/dau');
  });

  it('anchors a filter-only term to its specific glossary row — not the index', () => {
    const href = resolveConceptHref({
      id: 'whale',
      primaryCatalogId: null,
      defaultFilter: { member: 'mf_users.payer_tier', op: '=', value: 'whale' },
    });
    expect(href).toBe('/catalog/glossary#whale');
    // Must be the specific row anchor, never the bare index.
    expect(href).not.toBe('/catalog/glossary');
    expect(href).not.toBe('/catalog/glossary#');
  });

  it('builds a /build deep-link for terms with a measure ref', () => {
    const href = resolveConceptHref({
      id: 'arpu',
      primaryCatalogId: null,
      defaultMeasureRef: 'mf_users.arpu_vnd',
    });
    expect(href.startsWith('/build?')).toBe(true);
    const query = JSON.parse(new URLSearchParams(href.split('?')[1]).get('query')!);
    expect(query.measures).toEqual(['mf_users.arpu_vnd']);
  });

  it('anchors a plain term (no refs) to its row — never the index root', () => {
    const href = resolveConceptHref({ id: 'cohort', primaryCatalogId: null });
    expect(href).toBe('/catalog/glossary#cohort');
    expect(href).not.toBe('/catalog/glossary');
  });
});

// ─── conceptTypedActions ──────────────────────────────────────────────────────

describe('conceptTypedActions', () => {
  it('returns only Define for a plain term with no refs', () => {
    const actions = conceptTypedActions({ id: 'cohort', primaryCatalogId: null });
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe('define');
    expect(actions[0].to).toBe('/catalog/glossary#cohort');
    expect(actions[0].glyph).toBe('ⓘ');
  });

  it('returns Define + Slice for a filter-only concept term (whale)', () => {
    const actions = conceptTypedActions({
      id: 'whale',
      primaryCatalogId: null,
      defaultFilter: { member: 'mf_users.payer_tier', op: '=', value: 'whale' },
    });
    expect(actions).toHaveLength(2);
    expect(actions[0].kind).toBe('define');
    expect(actions[1].kind).toBe('slice');
    // Slice deep-link must go to /build
    expect(actions[1].to.startsWith('/build?')).toBe(true);
    // Slice from field member last segment
    expect(actions[1].label).toContain('payer_tier');
  });

  it('returns Define + See-metric for a business_metrics term', () => {
    const actions = conceptTypedActions({
      id: 'dau',
      primaryCatalogId: 'business_metrics/dau',
    });
    expect(actions).toHaveLength(2);
    expect(actions[0].kind).toBe('define');
    expect(actions[1].kind).toBe('metric');
    expect(actions[1].to).toBe('/catalog/metric/dau');
    expect(actions[1].glyph).toBe('▦');
  });

  it('returns Define + Slice + See-metric when both filter and business_metrics ref present', () => {
    const actions = conceptTypedActions({
      id: 'whale_revenue',
      primaryCatalogId: 'business_metrics/whale_revenue',
      defaultFilter: { member: 'mf_users.payer_tier', op: '=', value: 'whale' },
    });
    const kinds = actions.map((a) => a.kind);
    expect(kinds).toContain('define');
    expect(kinds).toContain('slice');
    expect(kinds).toContain('metric');
    // Order: define first, metric last (per spec)
    expect(kinds[0]).toBe('define');
    expect(kinds[kinds.length - 1]).toBe('metric');
  });

  it('define action always anchors the specific term row — never the index root', () => {
    const actions = conceptTypedActions({ id: 'funnel', primaryCatalogId: null });
    const define = actions.find((a) => a.kind === 'define')!;
    expect(define.to).toBe('/catalog/glossary#funnel');
    expect(define.to).not.toBe('/catalog/glossary');
  });

  it('slice action encodes the filter member and value into the query', () => {
    const actions = conceptTypedActions({
      id: 'dolphin',
      primaryCatalogId: null,
      defaultFilter: { member: 'mf_users.payer_tier', op: 'IN', value: ['dolphin', 'minnow'] },
    });
    const slice = actions.find((a) => a.kind === 'slice')!;
    const query = JSON.parse(new URLSearchParams(slice.to.split('?')[1]).get('query')!);
    expect(query.filters[0].values).toEqual(['dolphin', 'minnow']);
    expect(query.filters[0].operator).toBe('equals');
  });

  it('does not return a segment action (segment actions are async / hover-card only)', () => {
    const actions = conceptTypedActions({
      id: 'whale',
      primaryCatalogId: null,
      defaultFilter: { member: 'mf_users.payer_tier', op: '=', value: 'whale' },
    });
    expect(actions.some((a) => a.kind === 'segment')).toBe(false);
  });
});
