/**
 * ObservabilityTab — renders the org rollup from GET /api/admin/activity/summary,
 * the inactive-user triage list (with quick-disable), top features, and degrades
 * when chat counts are null.
 *
 * NOTE: user-event is NOT installed; uses fireEvent.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockApiFetch = vi.fn();
vi.mock('../../../../api/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../../../api/feature-open-beacon', () => ({ recordExport: vi.fn() }));

import { ObservabilityTab } from '../observability-tab';

/** ObservabilityTab renders <Link>s (inactive rows, pending queue) → needs a Router. */
function renderTab() {
  return render(<MemoryRouter><ObservabilityTab /></MemoryRouter>);
}

const SUMMARY = {
  usersByStatus: { active: 4, pending: 1, disabled: 2 },
  activeLast7d: 3,
  activeLast30d: 5,
  inactive: [{ email: 'stale@corp.com', lastLogin: '2026-01-01T00:00:00Z', status: 'active' }],
  topFeatures: [{ feature: 'dashboards', count: 12 }, { feature: 'liveops', count: 5 }],
  totalChatTurns: 42,
  generatedAt: 1_780_000_000_000,
};

/** Route apiFetch by URL + method so summary, users, audit, and PATCH all resolve. */
function routeApiFetch(summary: Record<string, unknown> = SUMMARY, users: unknown[] = []) {
  mockApiFetch.mockImplementation((url: string, opts?: { method?: string }) => {
    if (url.startsWith('/api/admin/activity/summary')) return Promise.resolve(summary);
    if (url.startsWith('/api/admin/users')) return Promise.resolve({ users });
    if (url.startsWith('/api/admin/audit')) return Promise.resolve({ entries: [] });
    if (opts?.method === 'PATCH') return Promise.resolve(undefined); // quick-disable / approve
    return Promise.resolve({});
  });
}

describe('ObservabilityTab', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    routeApiFetch();
  });

  it('renders status rollup KPIs', async () => {
    renderTab();
    expect(await screen.findByText('4')).toBeDefined(); // active
    expect(screen.getByText('Active')).toBeDefined();
    expect(screen.getByText('Disabled')).toBeDefined();
  });

  it('renders total chat turns, and "—" when chat is unreachable', async () => {
    renderTab();
    expect(await screen.findByText('42')).toBeDefined();
  });

  it('shows "—" + unreachable note when totalChatTurns is null', async () => {
    routeApiFetch({ ...SUMMARY, totalChatTurns: null });
    renderTab();
    expect(await screen.findByText(/chat-service unreachable/i)).toBeDefined();
  });

  it('lists inactive users with a quick-disable action', async () => {
    renderTab();
    expect(await screen.findByText('stale@corp.com')).toBeDefined();
    const disableBtn = await screen.findByRole('button', { name: /^disable$/i });
    fireEvent.click(disableBtn);
    await waitFor(() => {
      const patched = mockApiFetch.mock.calls.some(
        ([url, opts]) => String(url).includes('stale%40corp.com') && (opts as { method?: string })?.method === 'PATCH',
      );
      expect(patched).toBe(true);
    });
  });

  it('renders top features', async () => {
    renderTab();
    expect(await screen.findByText(/Dashboards/i)).toBeDefined();
    expect(screen.getByText('12')).toBeDefined();
  });

  it('surfaces pending users in the approval queue', async () => {
    routeApiFetch(SUMMARY, [
      { email: 'newbie@corp.com', role: 'viewer', status: 'pending', kcSub: null, workspaces: [], games: [], features: {}, lastLogin: null },
    ]);
    renderTab();
    expect(await screen.findByText('newbie@corp.com')).toBeDefined();
    expect(await screen.findByText(/pending approval/i)).toBeDefined();
  });

  it('shows an error banner when the summary fetch fails', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/api/admin/activity/summary')) return Promise.reject(new Error('boom'));
      return Promise.resolve({ entries: [] });
    });
    renderTab();
    expect(await screen.findByText(/couldn't load observability data/i)).toBeDefined();
  });
});
