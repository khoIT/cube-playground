/**
 * attachReplay tests — happy path, 409 retry with availableFromOffset,
 * and 403 → idle fallback (S4 coverage).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Controllable replay mock at module scope.
type Ev = { type: string; data?: any };
const replayQueues: Map<number, Ev[]> = new Map();
const replayResolvers: Map<number, () => void> = new Map();
const replayClosed: Set<number> = new Set();
let nextAttempt = 0;
const attemptOptions: Array<{ fromOffset?: number }> = [];
// Allows tests to script throws (overflow / forbidden) per attempt.
const overflowOnAttempt: Map<number, number> = new Map();
const errorOnAttempt: Map<number, string> = new Map();

function pushToAttempt(attempt: number, ev: Ev) {
  let q = replayQueues.get(attempt);
  if (!q) {
    q = [];
    replayQueues.set(attempt, q);
  }
  q.push(ev);
  const r = replayResolvers.get(attempt);
  if (r) {
    r();
    replayResolvers.delete(attempt);
  }
}
function closeAttempt(attempt: number) {
  replayClosed.add(attempt);
  const r = replayResolvers.get(attempt);
  if (r) {
    r();
    replayResolvers.delete(attempt);
  }
}

const { openChatTurnReplayMock, ReplayOverflowErrorClass } = vi.hoisted(() => {
  class ReplayOverflowErrorClass extends Error {
    readonly availableFromOffset: number;
    constructor(info: { availableFromOffset: number }) {
      super('overflow');
      this.name = 'ReplayOverflowError';
      this.availableFromOffset = info.availableFromOffset;
    }
  }
  const openChatTurnReplayMock = vi.fn();
  return { openChatTurnReplayMock, ReplayOverflowErrorClass };
});

vi.mock('../../api/chat-sse-client', () => ({
  openChatTurn: vi.fn(),
  openChatTurnReplay: openChatTurnReplayMock,
  ReplayOverflowError: ReplayOverflowErrorClass,
}));

vi.mock('../../shell/chat-overlay/chat-session-events', () => ({
  notifyChatSessionChanged: vi.fn(),
  onChatSessionChanged: vi.fn(() => () => {}),
}));

openChatTurnReplayMock.mockImplementation(
  (opts: { fromOffset?: number }) => {
    const attempt = nextAttempt++;
    attemptOptions.push(opts);
    const overflowAt = overflowOnAttempt.get(attempt);
    const error = errorOnAttempt.get(attempt);

    async function* gen(): AsyncIterable<Ev> {
      if (overflowAt !== undefined) {
        throw new ReplayOverflowErrorClass({ availableFromOffset: overflowAt });
      }
      if (error) {
        yield { type: 'error', data: { code: error, message: error } };
        return;
      }
      while (!replayClosed.has(attempt) || (replayQueues.get(attempt)?.length ?? 0) > 0) {
        const q = replayQueues.get(attempt) ?? [];
        if (q.length === 0) {
          await new Promise<void>((res) => replayResolvers.set(attempt, res));
        }
        const cur = replayQueues.get(attempt) ?? [];
        while (cur.length > 0) yield cur.shift()!;
      }
    }
    return { stream: gen(), cancel: vi.fn() };
  },
);

import { useChatStreamStore } from '../chat-stream-store';

async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

beforeEach(() => {
  replayQueues.clear();
  replayResolvers.clear();
  replayClosed.clear();
  attemptOptions.length = 0;
  overflowOnAttempt.clear();
  errorOnAttempt.clear();
  nextAttempt = 0;
  openChatTurnReplayMock.mockClear();
  useChatStreamStore.setState({
    streams: new Map(),
    aliases: new Map(),
  });
});

describe('attachReplay', () => {
  it('S4: streams buffered + live tail into the store entry', async () => {
    const s = useChatStreamStore.getState();
    void s.attachReplay('sess-1', 'turn-uuid-1', 0);
    await flush();

    expect(useChatStreamStore.getState().getEntry('sess-1').status).toBe('loading');

    pushToAttempt(0, { type: 'token', data: { delta: 'live ' } });
    pushToAttempt(0, { type: 'token', data: { delta: 'tail' } });
    pushToAttempt(0, { type: 'done', data: {} });
    closeAttempt(0);
    await flush();

    const entry = useChatStreamStore.getState().getEntry('sess-1');
    expect(entry.currentText).toBe('live tail');
    expect(entry.status).toBe('done');
  });

  it('retries from availableFromOffset on 409', async () => {
    overflowOnAttempt.set(0, 42);
    const s = useChatStreamStore.getState();
    void s.attachReplay('sess-2', 'turn-2', 0);
    await flush();

    // Second attempt was started; verify the from offset used.
    expect(openChatTurnReplayMock).toHaveBeenCalledTimes(2);
    expect(attemptOptions[1]?.fromOffset).toBe(42);

    // Drive the retry to done so we don't leak open generators.
    pushToAttempt(1, { type: 'token', data: { delta: 'after retry' } });
    pushToAttempt(1, { type: 'done', data: {} });
    closeAttempt(1);
    await flush();

    expect(useChatStreamStore.getState().getEntry('sess-2').currentText).toBe('after retry');
  });

  it('gives up after a second 409 → entry reset to idle', async () => {
    overflowOnAttempt.set(0, 50);
    overflowOnAttempt.set(1, 99);
    const s = useChatStreamStore.getState();
    void s.attachReplay('sess-3', 'turn-3', 0);
    await flush();

    const entry = useChatStreamStore.getState().getEntry('sess-3');
    expect(entry.status).toBe('idle');
    expect(entry.currentText).toBe('');
  });

  it('does NOT re-attach when a stream is already running for the session', async () => {
    const s = useChatStreamStore.getState();
    void s.attachReplay('sess-4', 'turn-4a', 0);
    await flush();
    expect(openChatTurnReplayMock).toHaveBeenCalledTimes(1);

    // Second attach for the same session should no-op because status is loading/streaming.
    await s.attachReplay('sess-4', 'turn-4b', 0);
    expect(openChatTurnReplayMock).toHaveBeenCalledTimes(1);

    closeAttempt(0);
    await flush();
  });
});
