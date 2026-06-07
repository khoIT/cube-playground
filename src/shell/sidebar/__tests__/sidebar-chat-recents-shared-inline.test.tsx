/**
 * SidebarChatRecents — shared sessions render INLINE below own recents with
 * a "Shared" pill (owner attribution in the pill tooltip); the old
 * "Shared with team" section heading is gone; own rows keep kebab menus.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// Real i18n init so the pill renders translated text + interpolated tooltip.
import '../../../i18n';

const useChatSessionsListMock = vi.fn();
vi.mock('../../../pages/Chat/hooks/use-chat-sessions-list', () => ({
  useChatSessionsList: (...args: unknown[]) => useChatSessionsListMock(...args),
}));
vi.mock('../../../shared/chat-recents/chat-row-kebab-menu', () => ({
  ChatRowKebabMenu: () => <span data-testid="kebab" />,
}));

import { SidebarChatRecents } from '../sidebar-chat-recents';

function mockLists({
  own = [] as Array<{ id: string; title: string }>,
  shared = [] as Array<{ id: string; title: string; ownerLabel?: string | null }>,
} = {}) {
  useChatSessionsListMock.mockImplementation(
    (_query?: string, opts?: { shared?: boolean }) =>
      opts?.shared
        ? { sessions: shared, isLoading: false, error: null }
        : { sessions: own, isLoading: false, error: null },
  );
}

function renderRecents() {
  return render(
    <MemoryRouter>
      <SidebarChatRecents />
    </MemoryRouter>,
  );
}

describe('SidebarChatRecents shared-inline', () => {
  it('renders shared sessions inline with a pill and NO section heading', () => {
    mockLists({
      own: [{ id: 'o1', title: 'My chat' }],
      shared: [{ id: 's1', title: 'Team chat', ownerLabel: 'alice' }],
    });
    renderRecents();

    expect(screen.queryByText(/shared with team/i)).toBeNull();
    expect(screen.getByText('My chat')).toBeTruthy();
    expect(screen.getByText('Team chat')).toBeTruthy();
    // Pill carries the owner attribution as its tooltip.
    const pill = screen.getByText(/Shared|nav\.sharedPill/);
    expect(pill.getAttribute('title')).toMatch(/alice/);
    // Shared row label no longer embeds "· by X" — moved into the tooltip.
    expect(screen.queryByText(/· by alice/)).toBeNull();
  });

  it('orders own sessions before shared ones', () => {
    mockLists({
      own: [{ id: 'o1', title: 'Own A' }],
      shared: [{ id: 's1', title: 'Shared B', ownerLabel: 'bob' }],
    });
    renderRecents();
    const labels = screen.getAllByText(/Own A|Shared B/).map((el) => el.textContent);
    expect(labels).toEqual(['Own A', 'Shared B']);
  });

  it('shows shared sessions even when the viewer has no own chats', () => {
    mockLists({ shared: [{ id: 's1', title: 'Team only', ownerLabel: 'carol' }] });
    renderRecents();
    expect(screen.getByText(/No conversations yet/)).toBeTruthy();
    expect(screen.getByText('Team only')).toBeTruthy();
    // No own sessions → no "See all" search row.
    expect(screen.queryByText(/See all/)).toBeNull();
  });

  it("drops the viewer's OWN published session from the shared group (no double row)", () => {
    // The server's shared listing has no owner exclusion — the viewer's own
    // shared session comes back in both lists and must render exactly once,
    // as an own row (kebab side), never with a pill.
    mockLists({
      own: [{ id: 'o1', title: 'My published chat' }],
      shared: [
        { id: 'o1', title: 'My published chat', ownerLabel: 'me' },
        { id: 's1', title: 'Team chat', ownerLabel: 'alice' },
      ],
    });
    renderRecents();
    expect(screen.getAllByText('My published chat')).toHaveLength(1);
    expect(screen.getByText('Team chat')).toBeTruthy();
    const pills = screen.getAllByText(/Shared|nav\.sharedPill/);
    expect(pills).toHaveLength(1);
    expect(pills[0].getAttribute('title')).toMatch(/alice/);
  });

  it('keeps kebab menus on own rows only (none on shared rows)', () => {
    mockLists({
      own: [{ id: 'o1', title: 'Own A' }],
      shared: [{ id: 's1', title: 'Shared B' }],
    });
    renderRecents();
    // Kebabs are hover-only; none mounted at rest, and shared rows never get one.
    expect(screen.queryAllByTestId('kebab').length).toBe(0);
    expect(screen.getByText(/See all/)).toBeTruthy();
  });
});
