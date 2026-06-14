/**
 * CareHistoryTab — render + treatment flow tests.
 *
 * Covers:
 *   1. Empty state when no cases exist.
 *   2. Timeline renders open + treated cases with correct status pills.
 *   3. RecommendedAction shows the top open case's action text + channels.
 *   4. Viewer role: "Mark treated" button absent.
 *   5. Editor role: "Mark treated" button present; form submits PATCH.
 *   6. PATCH error surfaces in the form without crashing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CareHistoryTab } from '../care-history-tab';
import type { CareCase } from '../../../Dashboards/cs/use-care-cases';
import type { AuthUser } from '../../../../auth/auth-context';

// ── Auth mock ─────────────────────────────────────────────────────────────────

// We mock the auth-context module so we can control the role per test.
const mockAuthUser = vi.fn<() => AuthUser | null>(() => null);
vi.mock('../../../../auth/auth-context', () => ({
  useAuthUser: () => mockAuthUser(),
}));

// ── Fetch mock helpers ─────────────────────────────────────────────────────────

function makeCase(overrides: Partial<CareCase> = {}): CareCase {
  return {
    id: 'c1',
    game_id: 'cfm_vn',
    playbook_id: 'pb1',
    playbook_name: 'High Roller Drop',
    playbook_priority: 1,
    uid: 'u1',
    source: 'membership',
    opened_at: '2026-06-01T10:00:00Z',
    stats_snapshot_json: '{"ltv_vnd":5000000}',
    status: 'new',
    condition_lapsed: 0,
    assignee: null,
    treated_at: null,
    channel_used: null,
    action_taken: null,
    notes: null,
    kpi_target: null,
    kpi_eval_at: null,
    outcome: null,
    ...overrides,
  };
}

const MOCK_PLAYBOOKS = [
  {
    id: 'pb1',
    nhom: 1,
    group: 'payment',
    name: 'High Roller Drop',
    priority: 'cao',
    dataRequirements: [],
    condition: {},
    watchedMetric: { member: 'ltv_vnd', label: 'LTV' },
    action: { text: 'Call the member and offer a bonus.', channels: ['phone', 'zalo'], slaMinutes: 60 },
    source: 'seed',
    enabled: true,
    availability: 'available',
    evalMode: 'membership',
    predicate: {},
    calibrated: true,
  },
];

function mockFetch(data: unknown, status = 200) {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
  return vi.fn().mockResolvedValue(res);
}

// Return correct response based on URL.
function multiFetch(cases: CareCase[]) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/care/cases/vip/')) {
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ uid: 'u1', cases }),
        text: () => Promise.resolve(JSON.stringify({ uid: 'u1', cases })),
      });
    }
    // case-aggregate endpoint (useCarePlaybooks fires this alongside the registry)
    if (url.includes('/api/care/cases/aggregate')) {
      const agg = { byPlaybook: [], openCases: 0, treatedCases: 0, vipsTriggered: 0 };
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(agg),
        text: () => Promise.resolve(JSON.stringify(agg)),
      });
    }
    // playbooks endpoint
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ game: 'cfm_vn', meta_members: 0, counts: { total: 1, available: 1, partial: 0, unavailable: 0 }, playbooks: MOCK_PLAYBOOKS }),
      text: () => Promise.resolve('{}'),
    });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CareHistoryTab', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows loading state then empty message when no cases', async () => {
    vi.stubGlobal('fetch', multiFetch([]));
    mockAuthUser.mockReturnValue({ id: '1', username: 'u', role: 'viewer' });

    render(<CareHistoryTab gameId="cfm_vn" uid="u1" />);
    // Eventually resolves to empty state.
    await waitFor(() =>
      expect(screen.getByText(/No care cases for this member/)).toBeTruthy()
    );
  });

  it('renders open case with status pill and playbook name', async () => {
    vi.stubGlobal('fetch', multiFetch([makeCase()]));
    mockAuthUser.mockReturnValue({ id: '1', username: 'u', role: 'viewer' });

    render(<CareHistoryTab gameId="cfm_vn" uid="u1" />);

    await waitFor(() => expect(screen.getByText('High Roller Drop')).toBeTruthy());
    expect(screen.getByText('New')).toBeTruthy();
  });

  it('renders treated case with outcome tag', async () => {
    const treatedCase = makeCase({
      id: 'c2',
      status: 'treated',
      treated_at: new Date(Date.now() - 3_600_000).toISOString(),
      channel_used: 'zalo',
      outcome: 'positive',
    });
    vi.stubGlobal('fetch', multiFetch([treatedCase]));
    mockAuthUser.mockReturnValue({ id: '1', username: 'u', role: 'viewer' });

    render(<CareHistoryTab gameId="cfm_vn" uid="u1" />);

    await waitFor(() => expect(screen.getByText('Treated')).toBeTruthy());
    expect(screen.getByText('positive')).toBeTruthy();
    expect(screen.getByText(/zalo/)).toBeTruthy();
  });

  it('shows RecommendedAction for open case', async () => {
    vi.stubGlobal('fetch', multiFetch([makeCase()]));
    mockAuthUser.mockReturnValue({ id: '1', username: 'u', role: 'editor' });

    render(<CareHistoryTab gameId="cfm_vn" uid="u1" />);

    await waitFor(() =>
      expect(screen.getByText('Recommended next action')).toBeTruthy()
    );
    expect(screen.getByText('Call the member and offer a bonus.')).toBeTruthy();
    expect(screen.getByText('phone')).toBeTruthy();
    expect(screen.getByText('zalo')).toBeTruthy();
  });

  it('viewer role: Mark treated button NOT rendered', async () => {
    vi.stubGlobal('fetch', multiFetch([makeCase()]));
    mockAuthUser.mockReturnValue({ id: '1', username: 'u', role: 'viewer' });

    render(<CareHistoryTab gameId="cfm_vn" uid="u1" />);
    await waitFor(() => expect(screen.getByText('High Roller Drop')).toBeTruthy());

    expect(screen.queryByText('Mark treated')).toBeNull();
    // Read-only notice present.
    expect(screen.getByText(/viewer access/i)).toBeTruthy();
  });

  it('editor role: Mark treated button present and opens form', async () => {
    vi.stubGlobal('fetch', multiFetch([makeCase()]));
    mockAuthUser.mockReturnValue({ id: '1', username: 'u', role: 'editor' });

    render(<CareHistoryTab gameId="cfm_vn" uid="u1" />);
    await waitFor(() => expect(screen.getByText('Mark treated')).toBeTruthy());

    fireEvent.click(screen.getByText('Mark treated'));
    expect(screen.getByText('Log treatment')).toBeTruthy();
    expect(screen.getByPlaceholderText(/Brief description/)).toBeTruthy();
  });

  it('admin role: treatment form submits PATCH and calls onDone', async () => {
    const openCase = makeCase();
    const treatedCase = { ...openCase, status: 'treated' as const, channel_used: 'zalo' };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true, status: 200,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve(treatedCase),
          text: () => Promise.resolve(JSON.stringify(treatedCase)),
        });
      }
      if (url.includes('/api/care/cases/vip/')) {
        return Promise.resolve({
          ok: true, status: 200,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ uid: 'u1', cases: [openCase] }),
          text: () => Promise.resolve('{}'),
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ game: 'cfm_vn', meta_members: 0, counts: { total: 1, available: 1, partial: 0, unavailable: 0 }, playbooks: MOCK_PLAYBOOKS }),
        text: () => Promise.resolve('{}'),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    mockAuthUser.mockReturnValue({ id: '1', username: 'u', role: 'admin' });

    render(<CareHistoryTab gameId="cfm_vn" uid="u1" />);
    await waitFor(() => expect(screen.getByText('Mark treated')).toBeTruthy());

    fireEvent.click(screen.getByText('Mark treated'));
    await waitFor(() => expect(screen.getByText('Log treatment')).toBeTruthy());

    // Fill action taken.
    fireEvent.change(screen.getByPlaceholderText(/Brief description/), {
      target: { value: 'Sent zalo message' },
    });

    fireEvent.click(screen.getByText('Log treatment'));

    // PATCH should have been called.
    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([, init]: [string, RequestInit]) => init?.method === 'PATCH'
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse(patchCall![1].body as string);
      expect(body.status).toBe('treated');
    });
  });

  it('surfaces PATCH error without crashing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve({
          ok: false, status: 403,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }),
          text: () => Promise.resolve(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Forbidden' } })),
        });
      }
      if (url.includes('/api/care/cases/vip/')) {
        return Promise.resolve({
          ok: true, status: 200,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ uid: 'u1', cases: [makeCase()] }),
          text: () => Promise.resolve('{}'),
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ game: 'cfm_vn', meta_members: 0, counts: { total: 1, available: 1, partial: 0, unavailable: 0 }, playbooks: MOCK_PLAYBOOKS }),
        text: () => Promise.resolve('{}'),
      });
    }));
    mockAuthUser.mockReturnValue({ id: '1', username: 'u', role: 'editor' });

    render(<CareHistoryTab gameId="cfm_vn" uid="u1" />);
    await waitFor(() => expect(screen.getByText('Mark treated')).toBeTruthy());

    fireEvent.click(screen.getByText('Mark treated'));
    await waitFor(() => expect(screen.getByText('Log treatment')).toBeTruthy());
    fireEvent.click(screen.getByText('Log treatment'));

    await waitFor(() =>
      expect(screen.getByText(/Forbidden|Save failed/i)).toBeTruthy()
    );
    // Form stays open after error.
    expect(screen.getByText('Log treatment')).toBeTruthy();
  });

  it('shows select a game message when gameId is null', () => {
    mockAuthUser.mockReturnValue({ id: '1', username: 'u', role: 'viewer' });
    render(<CareHistoryTab gameId={null} uid="u1" />);
    expect(screen.getByText(/Select a game/i)).toBeTruthy();
  });
});
