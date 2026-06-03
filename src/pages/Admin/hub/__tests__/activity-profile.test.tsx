/**
 * Tests for ActivityProfile — the observe-only per-user surface.
 *
 * Fetches the activity rollup + the derived session timeline (two apiFetch
 * calls keyed by URL). Covers vitals, recent query shapes / features, last
 * access change, the session timeline, and graceful degradation.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ActivityProfile } from '../activity-profile';

/** ActivityProfile renders <Link>s (playground deep-links) → needs a Router. */
function renderProfile(email: string) {
  return render(
    <MemoryRouter>
      <ActivityProfile email={email} />
    </MemoryRouter>,
  );
}

const mockApiFetch = vi.fn();
vi.mock('../../../../api/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

type ActivityPayload = Record<string, unknown>;
type SessionsPayload = Record<string, unknown>;

const EMPTY_SESSIONS: SessionsPayload = { sessions: [], sessions30: 0, avgDurationMs: 0, sparkline: new Array(30).fill(0) };

/** Route apiFetch by URL: /sessions → sessions payload, else → activity payload. */
function wire(activity: ActivityPayload, sessions: SessionsPayload = EMPTY_SESSIONS) {
  mockApiFetch.mockImplementation((url: string) =>
    url.includes('/sessions') ? Promise.resolve(sessions) : Promise.resolve(activity),
  );
}

const baseActivity: ActivityPayload = {
  email: 'test@example.com', sub: 'kc', status: 'active', role: 'editor',
  lastLogin: '2026-06-01T10:00:00Z', inactive: false, segmentCount: 0,
  recentFeatures: [], recentQueryShapes: [], chatStats: null, lastChange: null,
};

describe('ActivityProfile', () => {
  beforeEach(() => { mockApiFetch.mockReset(); });

  it('shows "chat-service unreachable" when chatStats is null', async () => {
    wire({ ...baseActivity, chatStats: null });
    renderProfile("test@example.com");
    expect(await screen.findByText(/chat-service unreachable/i)).toBeDefined();
  });

  it('renders recentFeatures chips when present', async () => {
    wire({ ...baseActivity, recentFeatures: ['dashboards', 'liveops'], chatStats: { turns: 20 } });
    renderProfile("test@example.com");
    expect(await screen.findByText(/Dashboards/i)).toBeDefined();
  });

  it('lists the actual measure & dimension member names of a query shape', async () => {
    wire({
      ...baseActivity,
      recentQueryShapes: [{ cubes: ['mf_users'], measures: ['mf_users.wau'], dimensions: ['mf_users.game_id'] }],
      chatStats: { turns: 1 },
    });
    renderProfile("test@example.com");
    // The member names themselves, not just counts — that's "what the query is".
    expect(await screen.findByText('mf_users.wau')).toBeDefined();
    expect(await screen.findByText('mf_users.game_id')).toBeDefined();
  });

  it('deep-links a query shape into the playground with its members', async () => {
    wire({
      ...baseActivity,
      recentQueryShapes: [{ cubes: ['mf_users'], measures: ['mf_users.wau'], dimensions: ['mf_users.game_id'] }],
      chatStats: { turns: 1 },
    });
    renderProfile("test@example.com");
    const link = (await screen.findByText(/open in playground/i)).closest('a') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('/build?query=');
    const query = JSON.parse(decodeURIComponent(href.split('?query=')[1]));
    expect(query.measures).toContain('mf_users.wau');
    expect(query.dimensions).toContain('mf_users.game_id');
  });

  it('renders the last access-management change from the audit log', async () => {
    wire({ ...baseActivity, lastChange: { actor: 'boss@corp.com', action: 'set_role', ts: '2026-06-02T10:00:00Z' } });
    renderProfile("test@example.com");
    expect(await screen.findByText(/set_role/i)).toBeDefined();
    expect(await screen.findByText(/boss@corp\.com/i)).toBeDefined();
  });

  it('shows "no recorded changes" when lastChange is null', async () => {
    wire({ ...baseActivity, lastChange: null });
    renderProfile("test@example.com");
    expect(await screen.findByText(/no recorded changes/i)).toBeDefined();
  });

  it('renders the derived session timeline when sessions are present', async () => {
    const start = Date.parse('2026-06-02T09:00:00Z');
    wire(baseActivity, {
      sessions: [{
        start, end: start + 12 * 60_000, durationMs: 12 * 60_000,
        events: [{ ts: start, type: 'feature_open', target: 'segments', shape: null }],
      }],
      sessions30: 1, avgDurationMs: 12 * 60_000, sparkline: new Array(30).fill(0),
    });
    renderProfile("test@example.com");
    expect(await screen.findByText(/session\(s\) · avg/i)).toBeDefined();
    // "12m" appears in both the avg note and the session-card duration.
    expect((await screen.findAllByText(/12m/i)).length).toBeGreaterThanOrEqual(1);
  });

  it('shows the empty-state when no sessions in 30 days', async () => {
    wire(baseActivity, EMPTY_SESSIONS);
    renderProfile("test@example.com");
    expect(await screen.findByText(/no sessions recorded/i)).toBeDefined();
  });

  it('degrades gracefully when the activity fetch fails — no crash', async () => {
    mockApiFetch.mockRejectedValue(new Error('network error'));
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = renderProfile("test@example.com"));
      await Promise.resolve();
    });
    expect(container).toBeDefined();
  });
});
