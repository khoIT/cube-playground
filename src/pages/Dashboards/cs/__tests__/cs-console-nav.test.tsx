/**
 * CS console step-nav: verifies wayfinding contract — the current step is marked
 * aria-current, prior steps link back (carrying ?game=), and the Member-360 step
 * is non-interactive unless it's the current page (no generic destination).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CsConsoleNav } from '../cs-console-nav';

function renderNav(props: React.ComponentProps<typeof CsConsoleNav>) {
  return render(
    <MemoryRouter>
      <CsConsoleNav {...props} />
    </MemoryRouter>,
  );
}

describe('CsConsoleNav', () => {
  it('marks the current step and links prior steps with the game param', () => {
    renderNav({ current: 'queue', gameId: 'cfm_vn' });

    const current = screen.getByText('Case Ledger / Queue').closest('[aria-current]');
    expect(current?.getAttribute('aria-current')).toBe('page');

    const monitor = screen.getByText('CS Monitor').closest('a') as HTMLAnchorElement;
    expect(monitor).toBeTruthy();
    expect(monitor.getAttribute('href')).toBe('/dashboards/cs?game=cfm_vn');
  });

  it('does not link the Member-360 step when it is not the current page', () => {
    renderNav({ current: 'monitor', gameId: 'cfm_vn' });
    const member = screen.getByText('Member-360 Care').closest('a');
    expect(member).toBeNull(); // no generic destination → rendered as a span
  });

  it('links the queue step forward from the monitor', () => {
    renderNav({ current: 'monitor', gameId: 'cfm_vn' });
    const queue = screen.getByText('Case Ledger / Queue').closest('a') as HTMLAnchorElement;
    expect(queue.getAttribute('href')).toBe('/dashboards/cs/queue?game=cfm_vn');
  });

  it('omits the game param when no game is provided', () => {
    renderNav({ current: 'member' });
    const monitor = screen.getByText('CS Monitor').closest('a') as HTMLAnchorElement;
    expect(monitor.getAttribute('href')).toBe('/dashboards/cs');
  });
});
