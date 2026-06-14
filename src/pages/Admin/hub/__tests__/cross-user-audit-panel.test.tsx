/**
 * Tests for CrossUserAuditPanel — the admin cross-user chat audit surface.
 *
 * Authorization boundary test: the panel MUST always pass ?email=<selectedEmail>
 * to every admin audit route. Without that param the server returns 400.
 *
 * Requests are routed through apiFetch (same as use-admin-access) so the
 * Bearer JWT is attached automatically. Tests mock apiFetch — NOT global fetch —
 * to assert the authenticated path is used.
 *
 * user-event is NOT installed — uses fireEvent throughout.
 */

import React from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CrossUserAuditPanel } from '../cross-user-audit-panel';
import type { AdminUser } from '../../access/use-admin-access';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock useAdminUsers so we control the user list without any real network call.
vi.mock('../../access/use-admin-access', () => ({
  useAdminUsers: vi.fn(),
}));

import { useAdminUsers } from '../../access/use-admin-access';
const mockUseAdminUsers = useAdminUsers as ReturnType<typeof vi.fn>;

// Mock apiFetch from api-client — the authenticated fetch wrapper used by the
// admin audit routes (requireRole('admin') + requireFeature('admin') guard).
// Mocking apiFetch (not global fetch) asserts the Bearer path is exercised.
const mockApiFetch = vi.fn();
vi.mock('../../../../api/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(email: string): AdminUser {
  return {
    email,
    role: 'editor',
    status: 'active',
    kcSub: `kc-${email}`,
    workspaces: [],
    games: [],
    features: {},
    lastLogin: null,
  };
}

function stubUsers(users: AdminUser[], loading = false, error: string | null = null) {
  mockUseAdminUsers.mockReturnValue({ users, loading, error, refetch: vi.fn() });
}

function stubApiFetchSessions(sessions: unknown[]) {
  mockApiFetch.mockResolvedValueOnce(sessions);
}

function stubApiFetchSessionDetail(detail: unknown) {
  mockApiFetch.mockResolvedValueOnce(detail);
}

function stubApiFetchError(status: number) {
  const err = Object.assign(new Error(`Request failed with status ${status}`), {
    name: 'SegmentApiError',
    code: 'HTTP_ERROR',
    status,
  });
  mockApiFetch.mockRejectedValueOnce(err);
}

function stubApiFetchNetworkError() {
  mockApiFetch.mockRejectedValueOnce(new Error('Network error'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CrossUserAuditPanel — empty state before user selection', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    stubUsers([makeUser('alice@vng.com'), makeUser('bob@vng.com')]);
  });

  it('shows empty-state prompt when no user is selected', () => {
    render(<CrossUserAuditPanel />);
    expect(screen.getByText(/select a user/i)).toBeDefined();
    // No fetch should be triggered before a user is picked.
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('renders the user select/list with available emails', () => {
    render(<CrossUserAuditPanel />);
    expect(screen.getByText('alice@vng.com')).toBeDefined();
    expect(screen.getByText('bob@vng.com')).toBeDefined();
  });

  it('shows loading indicator when user list is loading', () => {
    stubUsers([], true);
    render(<CrossUserAuditPanel />);
    expect(screen.getByText(/loading/i)).toBeDefined();
  });

  it('shows error message when user list fails', () => {
    stubUsers([], false, 'Failed to load users');
    render(<CrossUserAuditPanel />);
    expect(screen.getByText(/failed to load users/i)).toBeDefined();
  });
});

describe('CrossUserAuditPanel — authenticated path: apiFetch with email param', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    stubUsers([makeUser('alice@vng.com'), makeUser('bob@vng.com')]);
  });

  it('routes session fetch through apiFetch (not bare fetch) with correct email', async () => {
    stubApiFetchSessions([]);

    render(<CrossUserAuditPanel />);

    await act(async () => {
      fireEvent.click(screen.getByText('alice@vng.com'));
    });

    // apiFetch must be called — not global fetch
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    const calledUrl: string = mockApiFetch.mock.calls[0][0];
    expect(calledUrl).toContain('/api/admin/chat/sessions');
    expect(calledUrl).toContain('email=alice%40vng.com');
  });

  it('URL does NOT contain another user email when alice is selected', async () => {
    stubApiFetchSessions([]);

    render(<CrossUserAuditPanel />);

    await act(async () => {
      fireEvent.click(screen.getByText('alice@vng.com'));
    });

    const calledUrl: string = mockApiFetch.mock.calls[0][0];
    expect(calledUrl).not.toContain('bob');
  });

  it('re-fetches with new email via apiFetch when user selection changes', async () => {
    // First pick alice
    stubApiFetchSessions([]);
    // Second pick bob
    stubApiFetchSessions([]);

    render(<CrossUserAuditPanel />);

    await act(async () => {
      fireEvent.click(screen.getByText('alice@vng.com'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('bob@vng.com'));
    });

    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    const secondUrl: string = mockApiFetch.mock.calls[1][0];
    expect(secondUrl).toContain('email=bob%40vng.com');
  });
});

describe('CrossUserAuditPanel — sessions list rendering', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    stubUsers([makeUser('alice@vng.com')]);
  });

  it('renders session items from a mocked response', async () => {
    stubApiFetchSessions([
      {
        id: 'sess-1',
        title: 'Test session alpha',
        owner_id: 'kc-alice',
        game_id: 'muaw',
        created_at: 1717000000000,
        last_turn_at: 1717001000000,
        turn_count: 5,
        status: 'active',
        deletedAt: null,
      },
    ]);

    render(<CrossUserAuditPanel />);

    await act(async () => {
      fireEvent.click(screen.getByText('alice@vng.com'));
    });

    await waitFor(() => {
      expect(screen.getByText('Test session alpha')).toBeDefined();
    });
  });

  it('renders turn count for a session', async () => {
    stubApiFetchSessions([
      {
        id: 'sess-2',
        title: null,
        owner_id: 'kc-alice',
        game_id: 'muaw',
        created_at: 1717000000000,
        last_turn_at: null,
        turn_count: 12,
        status: 'active',
        deletedAt: null,
      },
    ]);

    render(<CrossUserAuditPanel />);

    await act(async () => {
      fireEvent.click(screen.getByText('alice@vng.com'));
    });

    await waitFor(() => {
      expect(screen.getByText(/12/)).toBeDefined();
    });
  });

  it('shows empty-sessions state when response is an empty array', async () => {
    stubApiFetchSessions([]);

    render(<CrossUserAuditPanel />);

    await act(async () => {
      fireEvent.click(screen.getByText('alice@vng.com'));
    });

    await waitFor(() => {
      expect(screen.getByText(/no sessions/i)).toBeDefined();
    });
  });

  it('shows cross-user admin view header note for selected user', async () => {
    stubApiFetchSessions([]);

    render(<CrossUserAuditPanel />);

    await act(async () => {
      fireEvent.click(screen.getByText('alice@vng.com'));
    });

    await waitFor(() => {
      // Email appears in both the user-picker button and the info banner — both are correct.
      const emailMatches = screen.getAllByText(/alice@vng\.com/i);
      expect(emailMatches.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/read-only/i)).toBeDefined();
    });
  });
});

describe('CrossUserAuditPanel — error handling', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    stubUsers([makeUser('alice@vng.com')]);
  });

  it('shows inline error message on non-200 response — no throw', async () => {
    stubApiFetchError(502);

    render(<CrossUserAuditPanel />);

    await act(async () => {
      fireEvent.click(screen.getByText('alice@vng.com'));
    });

    await waitFor(() => {
      // Must show some error text without crashing
      expect(screen.getByText(/error/i)).toBeDefined();
    });
  });

  it('shows inline error when fetch rejects — no crash', async () => {
    stubApiFetchNetworkError();

    render(<CrossUserAuditPanel />);

    // Should not throw
    await act(async () => {
      fireEvent.click(screen.getByText('alice@vng.com'));
    });

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeDefined();
    });
  });

  it('shows 404 message when user has no sessions (404 from server)', async () => {
    stubApiFetchError(404);

    render(<CrossUserAuditPanel />);

    await act(async () => {
      fireEvent.click(screen.getByText('alice@vng.com'));
    });

    await waitFor(() => {
      // Either "error" or "not found" text
      const el = screen.queryByText(/not found/i) ?? screen.queryByText(/error/i);
      expect(el).not.toBeNull();
    });
  });
});

describe('CrossUserAuditPanel — session detail', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    stubUsers([makeUser('alice@vng.com')]);
  });

  it('fetches session detail with email param on session click — via apiFetch', async () => {
    stubApiFetchSessions([
      {
        id: 'sess-detail-1',
        title: 'Detail session',
        owner_id: 'kc-alice',
        game_id: 'muaw',
        created_at: 1717000000000,
        last_turn_at: 1717001000000,
        turn_count: 3,
        status: 'active',
        deletedAt: null,
      },
    ]);
    stubApiFetchSessionDetail({
      session: {
        id: 'sess-detail-1',
        title: 'Detail session',
        owner_id: 'kc-alice',
        game_id: 'muaw',
        created_at: 1717000000000,
        last_turn_at: 1717001000000,
        turn_count: 3,
        status: 'active',
        deletedAt: null,
      },
      turns: [
        {
          id: 'turn-1',
          role: 'user',
          text: 'Hello from user',
          createdAt: new Date(1717000100000).toISOString(),
          toolCalls: [],
          legacy: false,
          llmCallCount: 0,
          toolInvocationCount: 0,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          model: null,
          skill: null,
          durationMs: null,
          stopReason: null,
          cacheCreationTokens: null,
          cacheReadTokens: null,
          cacheHit: false,
          originalTurnId: null,
          originalSessionId: null,
        },
      ],
    });

    render(<CrossUserAuditPanel />);

    await act(async () => {
      fireEvent.click(screen.getByText('alice@vng.com'));
    });

    await waitFor(() => {
      expect(screen.getByText('Detail session')).toBeDefined();
    });

    // Click the session row to load detail
    await act(async () => {
      fireEvent.click(screen.getByText('Detail session'));
    });

    // Verify the detail fetch went through apiFetch and carried the email param
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledTimes(2);
      const detailUrl: string = mockApiFetch.mock.calls[1][0];
      expect(detailUrl).toContain('/api/admin/chat/sessions/sess-detail-1');
      expect(detailUrl).toContain('email=alice%40vng.com');
    });
  });

  it('renders turns in session detail view', async () => {
    stubApiFetchSessions([
      {
        id: 'sess-detail-2',
        title: 'Session with turns',
        owner_id: 'kc-alice',
        game_id: 'muaw',
        created_at: 1717000000000,
        last_turn_at: 1717001000000,
        turn_count: 1,
        status: 'active',
        deletedAt: null,
      },
    ]);
    stubApiFetchSessionDetail({
      session: {
        id: 'sess-detail-2',
        title: 'Session with turns',
        owner_id: 'kc-alice',
        game_id: 'muaw',
        created_at: 1717000000000,
        last_turn_at: 1717001000000,
        turn_count: 1,
        status: 'active',
        deletedAt: null,
      },
      turns: [
        {
          id: 'turn-audit-1',
          role: 'user',
          text: 'Audit turn text',
          createdAt: new Date(1717000100000).toISOString(),
          toolCalls: [],
          legacy: false,
          llmCallCount: 0,
          toolInvocationCount: 0,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          model: null,
          skill: null,
          durationMs: null,
          stopReason: null,
          cacheCreationTokens: null,
          cacheReadTokens: null,
          cacheHit: false,
          originalTurnId: null,
          originalSessionId: null,
        },
      ],
    });

    render(<CrossUserAuditPanel />);

    await act(async () => {
      fireEvent.click(screen.getByText('alice@vng.com'));
    });

    await waitFor(() => {
      expect(screen.getByText('Session with turns')).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Session with turns'));
    });

    await waitFor(() => {
      expect(screen.getByText('Audit turn text')).toBeDefined();
    });
  });

  it('renders llmAuthLabel badge on assistant turns when present', async () => {
    stubApiFetchSessions([
      {
        id: 'sess-lane-1',
        title: 'Lane label session',
        owner_id: 'kc-alice',
        game_id: 'muaw',
        created_at: 1717000000000,
        last_turn_at: 1717001000000,
        turn_count: 2,
        status: 'active',
        deletedAt: null,
      },
    ]);
    stubApiFetchSessionDetail({
      session: {
        id: 'sess-lane-1',
        title: 'Lane label session',
        owner_id: 'kc-alice',
        game_id: 'muaw',
        created_at: 1717000000000,
        last_turn_at: 1717001000000,
        turn_count: 2,
        status: 'active',
        deletedAt: null,
      },
      turns: [
        {
          id: 'turn-lane-1',
          role: 'assistant',
          text: 'Lane test response',
          createdAt: new Date(1717000100000).toISOString(),
          toolCalls: [],
          legacy: false,
          llmCallCount: 1,
          toolInvocationCount: 0,
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.001,
          model: 'claude-test',
          skill: null,
          durationMs: 1200,
          stopReason: 'end_turn',
          llmAuthLabel: 'primary',
          cacheCreationTokens: null,
          cacheReadTokens: null,
          cacheHit: false,
          originalTurnId: null,
          originalSessionId: null,
        },
        {
          id: 'turn-lane-2',
          role: 'assistant',
          text: 'Fallback lane response',
          createdAt: new Date(1717000200000).toISOString(),
          toolCalls: [],
          legacy: false,
          llmCallCount: 1,
          toolInvocationCount: 0,
          inputTokens: 80,
          outputTokens: 40,
          costUsd: 0.0008,
          model: 'claude-test',
          skill: null,
          durationMs: 900,
          stopReason: 'end_turn',
          llmAuthLabel: 'subscription',
          cacheCreationTokens: null,
          cacheReadTokens: null,
          cacheHit: false,
          originalTurnId: null,
          originalSessionId: null,
        },
      ],
    });

    render(<CrossUserAuditPanel />);

    await act(async () => {
      fireEvent.click(screen.getByText('alice@vng.com'));
    });

    await waitFor(() => {
      expect(screen.getByText('Lane label session')).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Lane label session'));
    });

    await waitFor(() => {
      // Both lane labels must be visible in the turn rows
      expect(screen.getByText('primary')).toBeDefined();
      expect(screen.getByText('subscription')).toBeDefined();
    });
  });

  it('renders dash placeholder on turns where llmAuthLabel is null (legacy/cache-hit)', async () => {
    stubApiFetchSessions([
      {
        id: 'sess-null-lane',
        title: 'Null lane session',
        owner_id: 'kc-alice',
        game_id: 'muaw',
        created_at: 1717000000000,
        last_turn_at: 1717001000000,
        turn_count: 1,
        status: 'active',
        deletedAt: null,
      },
    ]);
    stubApiFetchSessionDetail({
      session: {
        id: 'sess-null-lane',
        title: 'Null lane session',
        owner_id: 'kc-alice',
        game_id: 'muaw',
        created_at: 1717000000000,
        last_turn_at: 1717001000000,
        turn_count: 1,
        status: 'active',
        deletedAt: null,
      },
      turns: [
        {
          id: 'turn-null-lane',
          role: 'assistant',
          text: 'Legacy turn text',
          createdAt: new Date(1717000100000).toISOString(),
          toolCalls: [],
          legacy: true,
          llmCallCount: 0,
          toolInvocationCount: 0,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          model: null,
          skill: null,
          durationMs: null,
          stopReason: null,
          llmAuthLabel: null,
          cacheCreationTokens: null,
          cacheReadTokens: null,
          cacheHit: false,
          originalTurnId: null,
          originalSessionId: null,
        },
      ],
    });

    render(<CrossUserAuditPanel />);

    await act(async () => {
      fireEvent.click(screen.getByText('alice@vng.com'));
    });

    await waitFor(() => {
      expect(screen.getByText('Null lane session')).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Null lane session'));
    });

    await waitFor(() => {
      expect(screen.getByText('Legacy turn text')).toBeDefined();
      // The "—" placeholder must be rendered for the null auth lane badge.
      // aria-label is the stable selector — avoids matching other "—" chars.
      const badge = document.querySelector('[aria-label="auth lane: —"]');
      expect(badge).not.toBeNull();
    });
  });
});
