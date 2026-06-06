/**
 * Cache-first member-360 serving — freshness rules of the cached panel
 * source, and MemberPanel's no-double-fetch contract: a cache hit (or a
 * pending cache lookup) must hold the live Cube query; miss/stale/error must
 * fall through to the live path unchanged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemberPanel } from '../member-panel';
import { isFreshCachedPanel, CACHE_MAX_AGE_MS } from '../use-cached-panel-source';
import { panelsForGame } from '../member360-panels';

vi.mock('../use-member-cube-query', () => ({
  useMemberCubeQuery: vi.fn(() => ({ rows: [], loading: false, error: null })),
}));
import { useMemberCubeQuery } from '../use-member-cube-query';

const rolesPanel = panelsForGame('cfm').find((p) => p.id === 'roles')!;

const NOW = Date.now();
const freshPanel = {
  rows: [{ 'user_roles_panel.role_id': 'r1', 'user_roles_panel.last_role_name': 'Sniper' }],
  fetched_at: new Date(NOW - 3600_000).toISOString(),
  status: 'ok' as const,
};

describe('isFreshCachedPanel', () => {
  it('accepts an ok panel within 36h, rejects stale/error/missing', () => {
    expect(isFreshCachedPanel(freshPanel, NOW)).toBe(true);
    expect(
      isFreshCachedPanel(
        { ...freshPanel, fetched_at: new Date(NOW - CACHE_MAX_AGE_MS - 1000).toISOString() },
        NOW,
      ),
    ).toBe(false);
    expect(isFreshCachedPanel({ ...freshPanel, status: 'error' }, NOW)).toBe(false);
    expect(isFreshCachedPanel({ ...freshPanel, fetched_at: 'garbage' }, NOW)).toBe(false);
    expect(isFreshCachedPanel(undefined, NOW)).toBe(false);
  });
});

describe('MemberPanel cache-first', () => {
  beforeEach(() => {
    vi.mocked(useMemberCubeQuery).mockClear();
    vi.mocked(useMemberCubeQuery).mockReturnValue({ rows: [], loading: false, error: null });
  });

  it('cache hit renders cached rows, suppresses the live query, shows the caption', () => {
    render(
      <MemberPanel
        gameId="cfm"
        panel={rolesPanel}
        idValues={['u1']}
        cached={{ rows: freshPanel.rows, fetchedAt: freshPanel.fetched_at }}
        cacheReady
      />,
    );
    // Live hook is called with a NULL query — no Cube load issued.
    for (const call of vi.mocked(useMemberCubeQuery).mock.calls) {
      expect(call[1]).toBeNull();
    }
    expect(screen.getByText('Sniper')).toBeTruthy();
    expect(screen.getByText(/precomputed/)).toBeTruthy();
  });

  it('pending cache lookup holds the live query (no double fetch)', () => {
    render(
      <MemberPanel gameId="cfm" panel={rolesPanel} idValues={['u1']} cached={null} cacheReady={false} />,
    );
    for (const call of vi.mocked(useMemberCubeQuery).mock.calls) {
      expect(call[1]).toBeNull();
    }
    expect(screen.getByText(/Loading/)).toBeTruthy();
  });

  it('cache miss with ready source goes live exactly as before — no caption', () => {
    vi.mocked(useMemberCubeQuery).mockReturnValue({
      rows: [{ 'user_roles_panel.role_id': 'r9' }],
      loading: false,
      error: null,
    });
    render(
      <MemberPanel gameId="cfm" panel={rolesPanel} idValues={['u1']} cached={null} cacheReady />,
    );
    const lastCall = vi.mocked(useMemberCubeQuery).mock.calls.at(-1)!;
    expect(lastCall[1]).not.toBeNull(); // live query issued
    expect(screen.getByText('r9')).toBeTruthy();
    expect(screen.queryByText(/precomputed/)).toBeNull();
  });

  it('live-only callers (no cache props) behave exactly as before', () => {
    render(<MemberPanel gameId="cfm" panel={rolesPanel} idValues={['u1']} />);
    const lastCall = vi.mocked(useMemberCubeQuery).mock.calls.at(-1)!;
    expect(lastCall[1]).not.toBeNull();
    expect(screen.queryByText(/precomputed/)).toBeNull();
  });
});
