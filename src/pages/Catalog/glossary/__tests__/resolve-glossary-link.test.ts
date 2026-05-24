import { describe, it, expect } from 'vitest';
import { resolveGlossaryHref } from '../resolve-glossary-link';

describe('resolveGlossaryHref', () => {
  it('routes business_metrics/<slug> terms to /catalog/metric/<slug>', () => {
    expect(resolveGlossaryHref({ id: 'dau', primaryCatalogId: 'business_metrics/dau' })).toBe(
      '/catalog/metric/dau',
    );
    expect(
      resolveGlossaryHref({ id: 'd1_retention', primaryCatalogId: 'business_metrics/d1_retention' }),
    ).toBe('/catalog/metric/d1_retention');
  });

  it('encodes slug parts that include URL-sensitive characters', () => {
    expect(
      resolveGlossaryHref({ id: 't', primaryCatalogId: 'business_metrics/has space' }),
    ).toBe('/catalog/metric/has%20space');
  });

  it('routes null primaryCatalogId to the glossary index', () => {
    expect(resolveGlossaryHref({ id: 'cohort', primaryCatalogId: null })).toBe('/catalog/glossary');
  });

  it('routes non-business_metrics catalog ids to the glossary index', () => {
    expect(
      resolveGlossaryHref({ id: 'whatever', primaryCatalogId: 'players.daily_active_users' }),
    ).toBe('/catalog/glossary');
  });

  it('treats an empty slug after the prefix as unresolvable', () => {
    expect(
      resolveGlossaryHref({ id: 'broken', primaryCatalogId: 'business_metrics/' }),
    ).toBe('/catalog/glossary');
  });
});
