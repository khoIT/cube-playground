/**
 * Tests for ChatPanel drag-resize: clamping and localStorage persistence.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mock heavy dependencies so the panel renders in a minimal test env.
// ---------------------------------------------------------------------------

vi.mock('../chat-panel-open-store', () => ({
  getOpen:  () => true,
  setOpen:  vi.fn(),
  getWidth: () => 420,
  setWidth: (n: number) => {
    localStorage.setItem('gds-cube:chat-panel:width', String(n));
  },
  onOpenChange:  vi.fn(() => () => {}),
  onWidthChange: vi.fn(() => () => {}),
  useChatPanelOpen:  () => true,
  useChatPanelWidth: () => 420,
}));

vi.mock('../use-active-chat-session', () => ({
  useActiveChatSession:   () => [null, vi.fn()],
  getActiveChatSession:   () => null,
  setActiveChatSession:   vi.fn(),
}));

vi.mock('../use-panel-chat-state', () => ({
  usePanelChatState: () => ({
    displayMessages: [],
    isStreaming: false,
    composerValue: '',
    setComposerValue: vi.fn(),
    handleSubmit: vi.fn(),
    cancel: vi.fn(),
    status: 'idle',
    liveSessionId: null,
    firstUserMessage: null,
  }),
}));

vi.mock('../chat-session-events', () => ({
  notifyChatSessionChanged: vi.fn(),
  onChatSessionChanged: vi.fn(() => () => {}),
}));

vi.mock('../../../shell/sidebar/recent-items-store', () => ({
  pushRecent: vi.fn(),
}));

vi.mock('../../../components/Header/use-game-context', () => ({
  useActiveGameId: () => 'ptg',
}));

import { ChatPanel } from '../chat-panel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPanel() {
  const onClose = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={['/build']}>
      <ChatPanel onClose={onClose} />
    </MemoryRouter>,
  );
  return { ...utils, onClose };
}

// jsdom (as used by vitest) does not ship PointerEvent. Polyfill it with
// MouseEvent so dispatchEvent works — clientX is readable on MouseEvent.
if (typeof globalThis.PointerEvent === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).PointerEvent = class PointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  };
}

function patchPointerCapture(el: Element) {
  if (!(el as any).setPointerCapture) {
    (el as any).setPointerCapture = vi.fn();
    (el as any).releasePointerCapture = vi.fn();
  }
}

function pointerEvent(type: string, clientX: number, buttons = 1) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (globalThis as any).PointerEvent(type, {
    clientX, buttons, bubbles: true, cancelable: true, pointerId: 1,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatPanel drag-resize', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  function getDragHandle(container: HTMLElement) {
    return container.querySelector('[data-testid="chat-panel-drag-handle"]') as HTMLElement;
  }

  function getPanel(container: HTMLElement) {
    return container.querySelector('[data-testid="chat-panel"]') as HTMLElement;
  }

  /**
   * Simulate a drag sequence.
   * startX → drag to moveX → release at upX.
   * dragStartWidth is supplied explicitly because jsdom offsetWidth is always 0.
   */
  function drag(handle: HTMLElement, startX: number, moveX: number, upX: number) {
    handle.dispatchEvent(pointerEvent('pointerdown', startX, 1));
    handle.dispatchEvent(pointerEvent('pointermove', moveX, 1));
    handle.dispatchEvent(pointerEvent('pointerup',   upX));
  }

  it('clamps width to 360 when dragged far right (below minimum)', () => {
    const { container } = renderPanel();
    const handle = getDragHandle(container);
    const panel  = getPanel(container);
    patchPointerCapture(handle);

    // startX=500, startWidth=420(mock). Drag right to 1000 → delta = 500-1000 = -500 → 420-500 = -80 → clamp 360.
    drag(handle, 500, 1000, 1000);

    expect(localStorage.getItem('gds-cube:chat-panel:width')).toBe('360');
    expect(panel.style.width).toBe('360px');
  });

  it('clamps width to 720 when dragged far left (above maximum)', () => {
    const { container } = renderPanel();
    const handle = getDragHandle(container);
    const panel  = getPanel(container);
    patchPointerCapture(handle);

    // startX=500, startWidth=420. Drag left to 0 → delta = 500-0 = 500 → 420+500 = 920 → clamp 720.
    drag(handle, 500, 0, 0);

    expect(localStorage.getItem('gds-cube:chat-panel:width')).toBe('720');
    expect(panel.style.width).toBe('720px');
  });

  it('persists an in-range width on pointerUp', () => {
    const { container } = renderPanel();
    const handle = getDragHandle(container);
    const panel  = getPanel(container);
    patchPointerCapture(handle);

    // startX=500, startWidth=420. Drag left 80px to 420 → delta = 500-420 = 80 → 420+80 = 500.
    drag(handle, 500, 420, 420);

    expect(localStorage.getItem('gds-cube:chat-panel:width')).toBe('500');
    expect(panel.style.width).toBe('500px');
  });
});
