/**
 * Cross-view resume tests (S1, S2, S3, S5).
 *
 * JSDOM-only — Playwright is not configured in this repo. The router is
 * memory-backed, but the store is the real singleton, so we can drive the
 * scenario:
 *  S1: side panel mid-stream survives main-view unmount.
 *  S2: main view picks up at the same accumulated state when re-mounted.
 *  S3: on `done`, both views see the final text.
 *  S5: only ONE SSE connection per turn (openChatTurn called once even though
 *      two consumers subscribe).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

// Controllable SSE mock at module scope so we can count fetches.
type Ev = { type: string; data?: any };
const queue: Ev[] = [];
let resolve: (() => void) | null = null;
let closed = false;

function push(ev: Ev) {
  queue.push(ev);
  resolve?.();
  resolve = null;
}

function close() {
  closed = true;
  resolve?.();
  resolve = null;
}

async function* fakeStream(): AsyncIterable<Ev> {
  while (!closed || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((r) => {
        resolve = r;
      });
    }
    while (queue.length > 0) yield queue.shift()!;
  }
}

const { openChatTurnMock } = vi.hoisted(() => ({
  openChatTurnMock: vi.fn(),
}));

vi.mock('../../../api/chat-sse-client', () => ({
  openChatTurn: openChatTurnMock,
}));

// Wire the mock implementation after the module-level fake-stream setup.
openChatTurnMock.mockImplementation(() => ({
  stream: fakeStream(),
  cancel: vi.fn(),
}));

vi.mock('../../../shell/chat-overlay/chat-session-events', () => ({
  notifyChatSessionChanged: vi.fn(),
  onChatSessionChanged: vi.fn(() => () => {}),
}));

import { useChatStream } from '../hooks/use-chat-stream';
import { useChatStreamStore } from '../../../stores/chat-stream-store';

async function flush() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// Probe components — render the current text so we can assert from the DOM.
function PanelView({ sessionId }: { sessionId: string | null }) {
  const { currentText, status } = useChatStream({ sessionId, game: 'ptg' });
  return (
    <div>
      <span data-testid="panel-text">{currentText}</span>
      <span data-testid="panel-status">{status}</span>
    </div>
  );
}

function MainView({ sessionId }: { sessionId: string | null }) {
  const { currentText, status, sendTurn } = useChatStream({ sessionId, game: 'ptg' });
  React.useEffect(() => {
    // Auto-submit on first mount when prop is null (mimics user submitting
    // from /chat empty hero).
    if (sessionId === null) {
      void sendTurn('Hi');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div>
      <span data-testid="main-text">{currentText}</span>
      <span data-testid="main-status">{status}</span>
    </div>
  );
}

beforeEach(() => {
  queue.length = 0;
  closed = false;
  resolve = null;
  openChatTurnMock.mockClear();
  useChatStreamStore.setState({ streams: new Map(), aliases: new Map() });
});

describe('cross-view resume', () => {
  it('S1+S2: panel keeps streaming after main view unmounts; new mount picks up accumulated state', async () => {
    // Mount both views together with sessionId='sess-1' to skip the new-session dance.
    // Start a turn from the main view, then unmount it and verify the panel keeps text.
    const main = render(<MainView sessionId={null} />);
    const panel = render(<PanelView sessionId={null} />);

    await flush();
    push({ type: 'session_created', data: { id: 'sess-1' } });
    push({ type: 'token', data: { delta: 'Hello ' } });
    await flush();

    expect(panel.getByTestId('panel-text').textContent).toBe('Hello ');
    expect(main.getByTestId('main-text').textContent).toBe('Hello ');

    // Unmount the main view (simulating module switch).
    main.unmount();

    // More tokens arrive — panel should still update.
    push({ type: 'token', data: { delta: 'world' } });
    await flush();
    expect(panel.getByTestId('panel-text').textContent).toBe('Hello world');

    // Re-mount the main view under the resolved session id.
    const main2 = render(<MainView sessionId="sess-1" />);
    await flush();
    expect(main2.getByTestId('main-text').textContent).toBe('Hello world');

    close();
    await flush();
    panel.unmount();
    main2.unmount();
  });

  it('S3: on done, both views observe the final accumulated text', async () => {
    const main = render(<MainView sessionId={null} />);
    const panel = render(<PanelView sessionId={null} />);

    await flush();
    push({ type: 'session_created', data: { id: 'sess-2' } });
    await flush();

    // Production transitions both surfaces from null → real id when
    // session_created fires (URL replace on the page, useActiveChatSession
    // mirror on the panel). Re-render with the real id so the views stay
    // bound to it through done — otherwise useChatStream's stale-state
    // guard (which prevents the next /chat visit from merging into this
    // session) hides post-done state from null-pinned subscribers.
    main.rerender(<MainView sessionId="sess-2" />);
    panel.rerender(<PanelView sessionId="sess-2" />);
    await flush();

    push({ type: 'token', data: { delta: 'Done line' } });
    push({ type: 'done', data: {} });
    close();
    await flush();

    expect(panel.getByTestId('panel-text').textContent).toBe('Done line');
    expect(main.getByTestId('main-text').textContent).toBe('Done line');
    expect(panel.getByTestId('panel-status').textContent).toBe('done');
    expect(main.getByTestId('main-status').textContent).toBe('done');

    panel.unmount();
    main.unmount();
  });

  it('S5: only ONE openChatTurn call per turn even with two subscribers', async () => {
    // Both mount with prop=null. Only the main view auto-submits.
    render(<MainView sessionId={null} />);
    render(<PanelView sessionId={null} />);

    await flush();

    expect(openChatTurnMock).toHaveBeenCalledTimes(1);

    close();
    await flush();
  });
});
