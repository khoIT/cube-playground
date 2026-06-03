import { describe, it, expect } from 'vitest';
import { parseFilterParams, serializeFilterParams } from '../glossary-filter-url';
import type { GlossaryStatus } from '../../../../api/glossary-client';
import type { WiringFacet } from '../glossary-filter';

describe('glossary filter URL state', () => {
  it('parses an empty search to all-empty (no constraints)', () => {
    const s = parseFilterParams('');
    expect(s.query).toBe('');
    expect(s.statuses.size).toBe(0);
    expect(s.wiring.size).toBe(0);
    expect(s.categories.size).toBe(0);
  });

  it('parses each axis from csv params', () => {
    const s = parseFilterParams('?q=whale&status=official&wiring=wired&cat=segments,monetisation');
    expect(s.query).toBe('whale');
    expect([...s.statuses]).toEqual(['official']);
    expect([...s.wiring]).toEqual(['wired']);
    expect([...s.categories].sort()).toEqual(['monetisation', 'segments']);
  });

  it('drops unknown status/wiring values (defensive against junk URLs)', () => {
    const s = parseFilterParams('?status=bogus,draft&wiring=nope');
    expect([...s.statuses]).toEqual(['draft']);
    expect(s.wiring.size).toBe(0);
  });

  it('serializes only non-empty axes and omits empties', () => {
    expect(
      serializeFilterParams({ query: '', statuses: new Set(), wiring: new Set(), categories: new Set() }),
    ).toBe('');
    const out = serializeFilterParams({
      query: '  arpu  ',
      statuses: new Set<GlossaryStatus>(['draft']),
      wiring: new Set<WiringFacet>(['definition']),
      categories: new Set(['monetisation']),
    });
    expect(out).toContain('q=arpu'); // trimmed
    expect(out).toContain('status=draft');
    expect(out).toContain('wiring=definition');
    expect(out).toContain('cat=monetisation');
  });

  it('round-trips parse∘serialize', () => {
    const state = {
      query: 'dau',
      statuses: new Set<GlossaryStatus>(['draft', 'official']),
      wiring: new Set<WiringFacet>(['wired']),
      categories: new Set(['engagement']),
    };
    const back = parseFilterParams(serializeFilterParams(state));
    expect(back.query).toBe('dau');
    expect([...back.statuses].sort()).toEqual(['draft', 'official']);
    expect([...back.wiring]).toEqual(['wired']);
    expect([...back.categories]).toEqual(['engagement']);
  });
});
