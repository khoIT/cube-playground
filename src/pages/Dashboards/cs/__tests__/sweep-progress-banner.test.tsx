/**
 * SweepProgressBanner — component contract tests.
 *
 * Locks these behaviors:
 *  1. Collapsed banner shows source + elapsed; the per-playbook breakdown is
 *     hidden until expanded.
 *  2. With progress, the header shows a "done/total" counter and toggles the
 *     breakdown open/closed on click.
 *  3. Each playbook row renders its live state: queued / sweeping… / opened·lapsed
 *     counts / skip reason (mapped to a human label).
 *  4. With no progress (empty array) the header is not a toggle — no counter,
 *     no chevron, no breakdown.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SweepProgressBanner } from '../sweep-progress-banner';
import type { PlaybookSweepProgress } from '../use-care-cases';

const PROGRESS: PlaybookSweepProgress[] = [
  { playbookId: '02', label: 'VIP tier change', state: 'done', cohortSize: 5, opened: 3, lapsed: 1 },
  { playbookId: '14', label: 'No-login winback', state: 'running' },
  { playbookId: '07', label: 'Big spender', state: 'pending' },
  { playbookId: '06', label: 'Leaderboard', state: 'done', skipped: 'unavailable', cohortSize: 0, opened: 0, lapsed: 0 },
];

describe('SweepProgressBanner', () => {
  it('shows source + elapsed and keeps the breakdown collapsed by default', () => {
    render(<SweepProgressBanner source="manual" startedAt="2026-06-10T00:00:00Z" elapsedS={198} progress={PROGRESS} />);
    expect(screen.getByText(/Sweep in progress \(manual\) — 198s elapsed/)).toBeTruthy();
    // Counter visible, but no playbook row until expanded.
    expect(screen.getByRole('button').textContent).toContain('2/4 done'); // skipped rows count as done
    expect(screen.queryByText('VIP tier change')).toBeNull();
  });

  it('expands to a per-playbook breakdown on click, rendering each live state', () => {
    render(<SweepProgressBanner source="cron" startedAt="2026-06-10T00:00:00Z" elapsedS={12} progress={PROGRESS} />);
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('VIP tier change')).toBeTruthy();
    expect(screen.getByText('opened 3 · lapsed 1')).toBeTruthy(); // done with counts
    expect(screen.getByText('sweeping…')).toBeTruthy(); // running
    expect(screen.getByText('queued')).toBeTruthy(); // pending
    expect(screen.getByText('skipped · not available for this game')).toBeTruthy(); // mapped skip label

    // State-grouped cards — active work first.
    expect(screen.getByText('Sweeping')).toBeTruthy();
    expect(screen.getByText('Queued')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();

    // Stat strip — running opened/lapsed totals across the whole sweep.
    expect(screen.getByText('3 opened')).toBeTruthy();
    expect(screen.getByText('1 lapsed')).toBeTruthy();

    // Cron source label.
    expect(screen.getByText(/\(auto-sweep\)/)).toBeTruthy();
  });

  it('collapses again on a second click', () => {
    render(<SweepProgressBanner source="manual" startedAt="2026-06-10T00:00:00Z" elapsedS={5} progress={PROGRESS} />);
    const toggle = screen.getByRole('button');
    fireEvent.click(toggle);
    expect(screen.getByText('VIP tier change')).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByText('VIP tier change')).toBeNull();
  });

  it('with no progress, the header is not an expandable toggle', () => {
    render(<SweepProgressBanner source="manual" startedAt="2026-06-10T00:00:00Z" elapsedS={30} progress={[]} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).not.toMatch(/\d+\/\d+ done/); // no done/total counter
    expect(btn.getAttribute('aria-expanded')).toBeNull(); // not a toggle
  });
});
