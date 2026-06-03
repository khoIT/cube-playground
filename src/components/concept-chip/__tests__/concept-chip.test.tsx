import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConceptChip } from '../concept-chip';

// Wrap renders in MemoryRouter because ConceptChip renders a <Link> when `to` is provided.
function renderChip(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('ConceptChip', () => {
  it('renders the label text', () => {
    renderChip(<ConceptChip kind="concept" label="Whale" />);
    expect(screen.getByText('Whale')).toBeTruthy();
  });

  // Each kind renders its lucide type-icon, matching the catalog's TypeIcon
  // vocabulary (measure→bar chart, dimension→hash, segment→users) + Info for
  // concepts. Lucide emits a per-icon class we can assert on.
  it('renders the bar-chart icon for kind=metric', () => {
    const { container } = renderChip(<ConceptChip kind="metric" label="DAU" />);
    expect(container.querySelector('svg.lucide-chart-column')).toBeTruthy();
  });

  it('renders the info icon for kind=concept', () => {
    const { container } = renderChip(<ConceptChip kind="concept" label="Funnel" />);
    expect(container.querySelector('svg.lucide-info')).toBeTruthy();
  });

  it('renders the hash icon for kind=field', () => {
    const { container } = renderChip(<ConceptChip kind="field" label="payer_tier" />);
    expect(container.querySelector('svg.lucide-hash')).toBeTruthy();
  });

  it('renders the users icon for kind=segment', () => {
    const { container } = renderChip(<ConceptChip kind="segment" label="Whales segment" />);
    expect(container.querySelector('svg.lucide-users')).toBeTruthy();
  });

  it('renders as an anchor link when `to` is provided', () => {
    renderChip(<ConceptChip kind="metric" label="DAU" to="/catalog/metric/dau" />);
    const link = screen.getByRole('link');
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/catalog/metric/dau');
  });

  it('renders as a button when `to` is not provided', () => {
    renderChip(<ConceptChip kind="concept" label="Whale" />);
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('shows the certified trust badge', () => {
    renderChip(<ConceptChip kind="metric" label="DAU" trust="certified" />);
    expect(screen.getByText('✓ certified')).toBeTruthy();
  });

  it('shows the draft trust badge', () => {
    renderChip(<ConceptChip kind="concept" label="Whale" trust="draft" />);
    expect(screen.getByText('draft')).toBeTruthy();
  });

  it('shows the deprecated trust badge', () => {
    renderChip(<ConceptChip kind="segment" label="Old seg" trust="deprecated" />);
    expect(screen.getByText('deprecated')).toBeTruthy();
  });

  it('shows no trust badge when trust prop is omitted', () => {
    renderChip(<ConceptChip kind="concept" label="Funnel" />);
    expect(screen.queryByText('✓ certified')).toBeNull();
    expect(screen.queryByText('draft')).toBeNull();
    expect(screen.queryByText('deprecated')).toBeNull();
  });
});
