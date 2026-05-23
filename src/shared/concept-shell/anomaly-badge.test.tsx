import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AnomalyBadge } from './anomaly-badge';

describe('AnomalyBadge', () => {
  it('renders nothing when anomaly is undefined', () => {
    const { container } = render(<AnomalyBadge anomaly={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when state is none', () => {
    const { container } = render(<AnomalyBadge anomaly={{ state: 'none' }} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the high-severity chip with delta', () => {
    render(<AnomalyBadge anomaly={{ state: 'high', deltaPct: -18.4 }} />);
    const chip = screen.getByRole('button');
    expect(chip.getAttribute('data-anomaly-state')).toBe('high');
    expect(chip.textContent).toContain('-18.4%');
  });

  it('fires onClick and stops propagation', () => {
    const onCardClick = vi.fn();
    const onBadgeClick = vi.fn();
    render(
      <div onClick={onCardClick} role="link">
        <AnomalyBadge
          anomaly={{ state: 'trend', deltaPct: 7.5 }}
          onClick={onBadgeClick}
        />
      </div>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onBadgeClick).toHaveBeenCalledTimes(1);
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
