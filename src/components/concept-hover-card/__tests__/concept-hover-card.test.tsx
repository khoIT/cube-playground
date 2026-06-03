import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// Keep relations idle so the card renders from sync fields only — this test is
// about where the card mounts, not its async content.
vi.mock('../../../api/concepts-client', () => ({
  getConceptRelations: vi.fn(() => new Promise(() => {})),
}));

import { ConceptHoverCard } from '../concept-hover-card';
import { _resetConceptResolutionCache } from '../use-concept-resolution';
import type { GlossaryTerm } from '../../../api/glossary-client';

const TERM: GlossaryTerm = {
  id: 'whale',
  label: 'Whale',
  description: 'Top-spender payer tier.',
  labelVi: null,
  descriptionVi: null,
  primaryCatalogId: null,
  secondaryCatalogIds: [],
  category: 'segments',
  aliases: [],
  aliasesVi: [],
  status: 'official',
  source: 'seed',
  editorName: null,
  trust: 'certified',
} as unknown as GlossaryTerm;

function renderCard() {
  return render(
    <MemoryRouter>
      <ConceptHoverCard term={TERM}>
        <span>Whale</span>
      </ConceptHoverCard>
    </MemoryRouter>,
  );
}

describe('ConceptHoverCard', () => {
  beforeEach(() => {
    _resetConceptResolutionCache();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('does not render the card until hovered', () => {
    renderCard();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('renders the card into a document.body portal on hover (escapes scroll-clip)', () => {
    const { container } = renderCard();
    const anchor = container.querySelector('.chc-wrap')!;
    act(() => {
      fireEvent.mouseEnter(anchor);
    });
    const tip = screen.getByRole('tooltip');
    // Portaled to body, NOT nested inside the anchor's scroll-clippable subtree.
    expect(tip.closest('.chc-wrap')).toBeNull();
    expect(document.body.contains(tip)).toBe(true);
    // Fixed-to-viewport so an ancestor overflow:auto cannot crop it.
    expect(tip.style.position).toBe('fixed');
    expect(tip.textContent).toContain('Whale');
  });

  it('keeps the card open while the pointer moves onto it, closes after leaving', () => {
    const { container } = renderCard();
    const anchor = container.querySelector('.chc-wrap')!;
    act(() => {
      fireEvent.mouseEnter(anchor);
    });
    const tip = screen.getByRole('tooltip');

    // Leaving the anchor schedules a close, but entering the card cancels it.
    act(() => {
      fireEvent.mouseLeave(anchor);
      fireEvent.mouseEnter(tip);
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole('tooltip')).not.toBeNull();

    // Leaving the card lets the grace period elapse → closed.
    act(() => {
      fireEvent.mouseLeave(tip);
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
