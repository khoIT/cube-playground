/**
 * Integration test for ChatOverlay route-driven auto-open behaviour.
 *
 * Drives a MemoryRouter through the exact transition the user reported:
 *   /chat/<id>  →  /build
 * and asserts the chat-panel store ends up open with the session id from
 * the previous path.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, useHistory } from 'react-router-dom';
import { ChatOverlay } from '../chat-overlay';
import { getOpen, setOpen } from '../chat-panel-open-store';
import { getActiveChatSession, setActiveChatSession } from '../use-active-chat-session';

const REAL_ID = '5ea11d04-020d-4624-b193-b7e8fc234972';

// Imperatively drives the router via useHistory so we can simulate clicking
// "Playground" from inside the /chat/:id route.
function RouterDriver({ onReady }: { onReady: (push: (p: string) => void) => void }) {
  const history = useHistory();
  React.useEffect(() => { onReady((p) => history.push(p)); }, [history, onReady]);
  return null;
}

describe('ChatOverlay route auto-open', () => {
  beforeEach(() => {
    // Reset shared atoms between tests.
    setOpen(false);
    setActiveChatSession(null);
  });

  it('leaving /chat/<id> for /build sets the active session and opens the panel', () => {
    let push: ((p: string) => void) | null = null;
    render(
      <MemoryRouter initialEntries={[`/chat/${REAL_ID}`]}>
        <ChatOverlay />
        <RouterDriver onReady={(p) => { push = p; }} />
      </MemoryRouter>,
    );

    // Sanity: initial deep-link should not auto-open (no prev path to compare).
    expect(getOpen()).toBe(false);
    expect(getActiveChatSession()).toBeNull();

    // Simulate clicking "Playground" in the topbar.
    act(() => { push!('/build'); });

    expect(getActiveChatSession()).toBe(REAL_ID);
    expect(getOpen()).toBe(true);
  });

  it('does NOT auto-open when leaving /chat (no id) for /build', () => {
    let push: ((p: string) => void) | null = null;
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <ChatOverlay />
        <RouterDriver onReady={(p) => { push = p; }} />
      </MemoryRouter>,
    );

    act(() => { push!('/build'); });

    expect(getOpen()).toBe(false);
    expect(getActiveChatSession()).toBeNull();
  });

  it('does NOT auto-open when leaving /chat/new for /build', () => {
    let push: ((p: string) => void) | null = null;
    render(
      <MemoryRouter initialEntries={['/chat/new']}>
        <ChatOverlay />
        <RouterDriver onReady={(p) => { push = p; }} />
      </MemoryRouter>,
    );

    act(() => { push!('/build'); });

    expect(getOpen()).toBe(false);
  });

  it('does NOT auto-open when navigating between chat routes', () => {
    let push: ((p: string) => void) | null = null;
    render(
      <MemoryRouter initialEntries={[`/chat/${REAL_ID}`]}>
        <ChatOverlay />
        <RouterDriver onReady={(p) => { push = p; }} />
      </MemoryRouter>,
    );

    act(() => { push!('/chat/other-id'); });

    expect(getOpen()).toBe(false);
  });

  it('game-change event closes the panel and clears the session', () => {
    setOpen(true);
    setActiveChatSession(REAL_ID);
    render(
      <MemoryRouter initialEntries={[`/chat/${REAL_ID}`]}>
        <ChatOverlay />
      </MemoryRouter>,
    );

    act(() => {
      window.dispatchEvent(new Event('gds-cube:game-change'));
    });

    expect(getOpen()).toBe(false);
    expect(getActiveChatSession()).toBeNull();
  });
});
