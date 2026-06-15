/**
 * SidebarSection split header — the label/icon navigates to the section page;
 * a separate arrow button toggles the child list. The two must not cross:
 * clicking the label never toggles, clicking the arrow never navigates.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';

// jsdom doesn't implement scrollIntoView; the section's row calls it via an
// active-state effect once navigation marks it active. Stub it so the
// navigation assertion isn't masked by an unrelated environment gap.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

const setSectionExpandedMock = vi.fn();
vi.mock('../sidebar-section-store', () => ({
  getSectionExpanded: () => true, // expanded → split header + children render
  setSectionExpanded: (...args: unknown[]) => setSectionExpandedMock(...args),
}));

import { SidebarSection } from '../sidebar-section';

// Probe that surfaces the current pathname so we can assert (non-)navigation.
function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="pathname">{pathname}</div>;
}

function renderSection() {
  return render(
    <MemoryRouter initialEntries={['/start']}>
      <SidebarSection id="metrics-catalog" icon={BarChart3} label="Metrics" to="/metrics">
        <div>Child A</div>
      </SidebarSection>
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('SidebarSection split header', () => {
  beforeEach(() => setSectionExpandedMock.mockClear());

  it('renders the label as a link to the section page', () => {
    renderSection();
    const link = screen.getByText('Metrics').closest('a');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('/metrics');
  });

  it('exposes a labelled toggle arrow button', () => {
    renderSection();
    expect(screen.getByRole('button', { name: 'Toggle Metrics list' })).toBeTruthy();
  });

  it('arrow click toggles the section without navigating', () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Metrics list' }));
    expect(setSectionExpandedMock).toHaveBeenCalledWith('metrics-catalog', false);
    expect(screen.getByTestId('pathname').textContent).toBe('/start');
  });

  it('label click navigates without toggling the section', () => {
    renderSection();
    fireEvent.click(screen.getByText('Metrics'));
    expect(screen.getByTestId('pathname').textContent).toBe('/metrics');
    expect(setSectionExpandedMock).not.toHaveBeenCalled();
  });

  it('shows the child list while expanded', () => {
    renderSection();
    expect(screen.getByText('Child A')).toBeTruthy();
  });
});
