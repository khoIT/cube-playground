/**
 * AnomalyTileBadge — renders only when there is a matching open anomaly;
 * clicking it navigates to the filtered inbox.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AnomalyTileBadge } from './anomaly-tile-badge';

// Mock useHistory
const mockPush = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useHistory: () => ({ push: mockPush }),
  };
});

function renderBadge(severity: 'low' | 'med' | 'high', metric: string) {
  return render(
    <MemoryRouter>
      <AnomalyTileBadge severity={severity} metric={metric} />
    </MemoryRouter>
  );
}

describe('AnomalyTileBadge', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders a button with correct aria-label', () => {
    renderBadge('high', 'active_daily.dau');
    const btn = screen.getByRole('button', { name: /high anomaly on active_daily\.dau/i });
    expect(btn).toBeTruthy();
  });

  it('renders for med severity', () => {
    renderBadge('med', 'user_recharge_daily.revenue_vnd_total');
    expect(screen.getByRole('button', { name: /med anomaly/i })).toBeTruthy();
  });

  it('renders for low severity', () => {
    renderBadge('low', 'active_daily.dau');
    expect(screen.getByRole('button', { name: /low anomaly/i })).toBeTruthy();
  });

  it('navigates to /liveops/anomalies?metric=<encoded> on click', () => {
    renderBadge('high', 'active_daily.dau');
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(mockPush).toHaveBeenCalledWith(
      '/liveops/anomalies?metric=active_daily.dau'
    );
  });

  it('stops propagation on click (does not bubble to tile)', () => {
    const tileClick = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <div onClick={tileClick}>
          <AnomalyTileBadge severity="high" metric="active_daily.dau" />
        </div>
      </MemoryRouter>
    );
    const btn = container.querySelector('button')!;
    fireEvent.click(btn);
    expect(tileClick).not.toHaveBeenCalled();
  });
});
