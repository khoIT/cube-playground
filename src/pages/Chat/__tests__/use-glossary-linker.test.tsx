import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useGlossaryLinker, _resetGlossaryCache } from '../components/use-glossary-linker';

const FAKE_TERMS = [
  {
    id: 'whale',
    label: 'Whale',
    description: 'top spenders',
    primaryCatalogId: 'business_metrics/whale_payer',
    secondaryCatalogIds: [],
    aliases: ['whale', 'whales'],
    category: 'segments',
    updatedAt: '2026-05-24T00:00:00.000Z',
  },
  {
    id: 'dau',
    label: 'DAU',
    description: 'daily active users',
    primaryCatalogId: 'business_metrics/dau',
    secondaryCatalogIds: [],
    aliases: ['dau', 'daily active users'],
    category: 'engagement',
    updatedAt: '2026-05-24T00:00:00.000Z',
  },
];

describe('useGlossaryLinker', () => {
  beforeEach(() => {
    _resetGlossaryCache();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ terms: FAKE_TERMS }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
  });

  it('wraps known terms on word boundaries', async () => {
    const { result } = renderHook(() => useGlossaryLinker());
    await waitFor(() => expect(result.current.terms.length).toBeGreaterThan(0));

    const out = result.current.link('A whale buys more than a DAU each day');
    const labels = out.map((s) => `${s.kind}:${s.text}`);
    expect(labels).toContain('term:whale');
    expect(labels).toContain('term:DAU');
  });

  it('respects word boundaries — substring matches are NOT wrapped inside other words', async () => {
    const { result } = renderHook(() => useGlossaryLinker());
    await waitFor(() => expect(result.current.terms.length).toBeGreaterThan(0));

    const out = result.current.link('the daubed wall');
    const anyTerm = out.find((s) => s.kind === 'term' && s.text.toLowerCase() === 'dau');
    expect(anyTerm).toBeUndefined();
  });

  it('returns a single text segment when no terms are present', async () => {
    const { result } = renderHook(() => useGlossaryLinker());
    await waitFor(() => expect(result.current.terms.length).toBeGreaterThan(0));

    const out = result.current.link('nothing to link here');
    expect(out).toEqual([{ kind: 'text', text: 'nothing to link here' }]);
  });

  it('carries primaryCatalogId on term segments so the renderer can route them', async () => {
    const { result } = renderHook(() => useGlossaryLinker());
    await waitFor(() => expect(result.current.terms.length).toBeGreaterThan(0));

    const out = result.current.link('DAU is the metric');
    const dauTerm = out.find((s) => s.kind === 'term' && s.text === 'DAU');
    expect(dauTerm?.primaryCatalogId).toBe('business_metrics/dau');
  });
});
