/**
 * chat-stream-store — singleton Zustand store keyed by sessionId.
 *
 * Why singleton (not the factory + Context pattern used elsewhere): streaming
 * state must survive component unmount + remount across the side-panel and
 * `/chat/:id` route. A per-instance store would live and die with whichever
 * view mounted first; a singleton keeps the live SSE loop alive while
 * subscribers come and go.
 *
 * Key model:
 *   - Entries live in `streams: Map<string, StreamEntry>`, keyed by whatever
 *     sessionId the turn was started with ('__new__' if started with null).
 *   - When `session_created` (or `compact_warning`) advances the sessionId, the
 *     entry stays at its original key. A separate `aliases` map records
 *     `realSessionId → originalKey` so subscribers using the new id resolve to
 *     the same entry without a re-key flicker.
 *
 * Lifecycle:
 *   startTurn(sessionId)  → opens SSE, sets cancel handle, starts dispatch loop
 *   subscribe(sessionId)  → refcount++ (never aborts the fetch)
 *   unsubscribe(sessionId)→ refcount--
 *   cancel(sessionId)     → explicit user abort (Stop button)
 */
import { create, type StoreApi } from 'zustand';
import {
  openChatTurn,
  openChatTurnReplay,
  ReplayOverflowError,
  type SseEvent,
} from '../api/chat-sse-client';
import { notifyChatSessionChanged } from '../shell/chat-overlay/chat-session-events';
import {
  applySseEvent,
  clearStreamBuffers,
  makeIdleEntry,
  type StreamEntry,
} from './chat-stream-store-actions';

export type {
  StreamEntry,
  StreamStatus,
  ToolCallState,
  CompactWarning,
} from './chat-stream-store-actions';

const NEW_SESSION_KEY = '__new__';

function keyOf(sessionId: string | null): string {
  return sessionId ?? NEW_SESSION_KEY;
}

interface StartTurnOptions {
  sessionId: string | null;
  message: string;
  game: string;
  context?: unknown;
  mode?: 'targeted' | 'aggressive';
  /** Phase-06: when true, sends X-Bypass-Cache: 1 to skip the response cache. */
  bypassCache?: boolean;
}

interface ChatStreamStore {
  streams: Map<string, StreamEntry>;
  /** realSessionId → originalKey in `streams`. */
  aliases: Map<string, string>;

  /** Refcount only — never cancels the live fetch. */
  subscribe: (sessionId: string | null) => void;
  unsubscribe: (sessionId: string | null) => void;

  /**
   * Returns the slice for the given sessionId, or an idle placeholder.
   * NOTE: do not call from inside a React selector — returns a fresh idle
   * object on miss, which would force a re-render every snapshot. Use the
   * inline selector pattern in `useChatStream` instead.
   */
  getEntry: (sessionId: string | null) => StreamEntry;

  startTurn: (opts: StartTurnOptions) => Promise<void>;
  /**
   * Attach to an in-flight turn after refresh. Streams buffered events from
   * `fromOffset` then tails the live registry. 409 overflow triggers a single
   * retry from the server-reported `availableFromOffset`. Subsequent 409 →
   * give up; clear the entry.
   */
  attachReplay: (sessionId: string, turnId: string, fromOffset?: number) => Promise<void>;
  /** Explicit user-initiated abort. */
  cancel: (sessionId: string | null) => void;
  /** Drop streaming buffers after consumer commits them to history. */
  clearBuffers: (sessionId: string | null) => void;
  /** Wipe an entry entirely (e.g. New chat from the panel). */
  reset: (sessionId: string | null) => void;
}

/** Resolve a sessionId-derived key through the alias map. */
function resolveKey(s: ChatStreamStore, sessionId: string | null): string {
  const direct = keyOf(sessionId);
  return s.aliases.get(direct) ?? direct;
}

export const useChatStreamStore = create<ChatStreamStore>((set, get) => ({
  streams: new Map(),
  aliases: new Map(),

  subscribe: (sessionId) => {
    set((s) => {
      const key = resolveKey(s, sessionId);
      const next = new Map(s.streams);
      const cur = next.get(key) ?? makeIdleEntry(sessionId);
      next.set(key, { ...cur, refCount: cur.refCount + 1 });
      return { streams: next };
    });
  },

  unsubscribe: (sessionId) => {
    set((s) => {
      const key = resolveKey(s, sessionId);
      const cur = s.streams.get(key);
      if (!cur) return s;
      const next = new Map(s.streams);
      next.set(key, { ...cur, refCount: Math.max(0, cur.refCount - 1) });
      return { streams: next };
    });
  },

  getEntry: (sessionId) => {
    const s = get();
    return s.streams.get(resolveKey(s, sessionId)) ?? makeIdleEntry(sessionId);
  },

  startTurn: async ({ sessionId, message, game, context, mode, bypassCache }) => {
    const key = resolveKey(get(), sessionId);
    const existing = get().streams.get(key);
    // Defense-in-depth: composer disables while streaming. Silent no-op if a
    // turn for this session is already in flight.
    if (existing?.status === 'streaming' || existing?.status === 'loading') {
      return;
    }

    const { stream, cancel } = openChatTurn({ sessionId, message, game, context, mode, bypassCache });

    // Seed entry into 'loading' with cancel handle, preserve refcount.
    set((s) => {
      const next = new Map(s.streams);
      const cur = s.streams.get(key) ?? makeIdleEntry(sessionId);
      next.set(key, {
        ...makeIdleEntry(sessionId),
        refCount: cur.refCount,
        lastCompactWarning: cur.lastCompactWarning,
        status: 'loading',
        cancel,
      });
      return { streams: next };
    });

    await runDispatchLoop(set, get, key, sessionId, stream);
  },

  attachReplay: async (sessionId, turnId, fromOffset = 0) => {
    const key = resolveKey(get(), sessionId);
    const existing = get().streams.get(key);
    // Don't double-attach if a stream for this session is already running.
    if (existing?.status === 'streaming' || existing?.status === 'loading') {
      return;
    }
    await runReplayAttempt(set, get, key, sessionId, turnId, fromOffset, 0);
  },

  cancel: (sessionId) => {
    const s = get();
    const key = resolveKey(s, sessionId);
    const cur = s.streams.get(key);
    cur?.cancel?.();
    set((st) => {
      const next = new Map(st.streams);
      const e = st.streams.get(key);
      if (!e) return st;
      next.set(key, { ...makeIdleEntry(e.sessionId), refCount: e.refCount });
      return { streams: next };
    });
  },

  clearBuffers: (sessionId) => {
    set((s) => {
      const key = resolveKey(s, sessionId);
      const cur = s.streams.get(key);
      if (!cur) return s;
      const next = new Map(s.streams);
      next.set(key, clearStreamBuffers(cur));
      return { streams: next };
    });
  },

  reset: (sessionId) => {
    set((s) => {
      const key = resolveKey(s, sessionId);
      const cur = s.streams.get(key);
      const next = new Map(s.streams);
      next.set(key, makeIdleEntry(sessionId));
      if (cur) cur.cancel?.();
      return { streams: next };
    });
  },
}));

// ---------------------------------------------------------------------------
// Internal — dispatch loop reused by startTurn (Phase 2) and attachReplay
// (Phase 7). Kept here so the store file remains the single owner of mutations.
// ---------------------------------------------------------------------------

type SetFn = StoreApi<ChatStreamStore>['setState'];
type GetFn = StoreApi<ChatStreamStore>['getState'];

async function runDispatchLoop(
  set: SetFn,
  get: GetFn,
  key: string,
  initialSessionId: string | null,
  stream: AsyncIterable<SseEvent>,
): Promise<void> {
  let sawDone = false;
  // The store key stays fixed at the original `key` for the lifetime of this
  // turn. Only the entry's internal `sessionId` advances; aliases pick up the
  // new ids so future subscribers find the same entry.
  let currentSessionId: string | null = initialSessionId;

  function applyEvent(event: SseEvent): void {
    set((s) => {
      const cur = s.streams.get(key);
      if (!cur) return s;
      const updated = applySseEvent(cur, event);

      const nextStreams = new Map(s.streams);
      nextStreams.set(key, updated);

      // If the entry's sessionId moved (session_created or compact_warning),
      // record the alias so subscribers using the new id resolve here.
      let nextAliases = s.aliases;
      const newSid = updated.sessionId;
      if (newSid && newSid !== currentSessionId) {
        nextAliases = new Map(s.aliases);
        nextAliases.set(newSid, key);
        currentSessionId = newSid;
      }
      return { streams: nextStreams, aliases: nextAliases };
    });
  }

  try {
    for await (const event of stream) {
      applyEvent(event);

      if (event.type === 'session_created') {
        notifyChatSessionChanged(event.data.id);
      }
      if (event.type === 'done') {
        sawDone = true;
      }
    }
    if (!sawDone) {
      set((s) => {
        const cur = s.streams.get(key);
        if (!cur) return s;
        // cancel()/reset() abort the fetch and synchronously park the entry
        // at 'idle'. The aborted iterator then returns cleanly (no `done`
        // event), landing us here — don't surface a user-initiated stop as
        // "Connection lost".
        if (cur.status === 'idle') return s;
        const next = new Map(s.streams);
        next.set(key, { ...cur, status: 'disconnected' });
        return { streams: next };
      });
    }
  } catch (err: unknown) {
    if (!(err instanceof Error) || err.name === 'AbortError') return;
    // Replay-overflow is a control-flow signal: surface it to the caller
    // (runReplayAttempt) so it can retry from the server-reported offset
    // instead of stamping the entry as 'error'.
    if (err instanceof ReplayOverflowError) throw err;
    const message = err.message;
    set((s) => {
      const cur = s.streams.get(key);
      if (!cur) return s;
      const next = new Map(s.streams);
      next.set(key, { ...cur, status: 'error', error: message });
      return { streams: next };
    });
  } finally {
    // Strip the cancel handle once the loop exits (subsequent cancel() calls
    // become no-ops).
    set((s) => {
      const cur = s.streams.get(key);
      if (!cur) return s;
      const next = new Map(s.streams);
      const { cancel: _drop, ...rest } = cur;
      next.set(key, rest);
      return { streams: next };
    });

    if (sawDone) {
      const sid = currentSessionId;
      if (sid) notifyChatSessionChanged(sid);
    }
  }
}

/**
 * Attach-replay attempt with one retry on `ring_overflow`. If the second
 * attempt also overflows, drop the entry — caller will surface idle state.
 */
async function runReplayAttempt(
  set: SetFn,
  get: GetFn,
  key: string,
  sessionId: string,
  turnId: string,
  fromOffset: number,
  attempt: number,
): Promise<void> {
  let handle: ReturnType<typeof openChatTurnReplay>;
  try {
    handle = openChatTurnReplay({ sessionId, turnId, fromOffset });
  } catch (err) {
    // Synchronous construction errors shouldn't happen, but guard anyway.
    if (err instanceof Error) {
      set((s) => {
        const cur = s.streams.get(key);
        if (!cur) return s;
        const next = new Map(s.streams);
        next.set(key, { ...cur, status: 'error', error: err.message });
        return { streams: next };
      });
    }
    return;
  }

  set((s) => {
    const next = new Map(s.streams);
    const cur = s.streams.get(key) ?? makeIdleEntry(sessionId);
    next.set(key, {
      ...makeIdleEntry(sessionId),
      refCount: cur.refCount,
      turnId,
      status: 'loading',
      cancel: handle.cancel,
    });
    return { streams: next };
  });

  try {
    await runDispatchLoop(set, get, key, sessionId, handle.stream);
  } catch (err) {
    if (err instanceof ReplayOverflowError && attempt === 0) {
      // One retry from the server-reported offset. Toast wording lives in the
      // hook layer; here we just restart the attach.
      await runReplayAttempt(
        set,
        get,
        key,
        sessionId,
        turnId,
        err.availableFromOffset,
        attempt + 1,
      );
      return;
    }
    // Final overflow → reset entry; UI will fall back to idle. Preserve
    // refCount so existing subscribers aren't accidentally forgotten — same
    // invariant `startTurn` upholds when seeding a fresh entry.
    set((s) => {
      const next = new Map(s.streams);
      const cur = s.streams.get(key);
      next.set(key, {
        ...makeIdleEntry(sessionId),
        refCount: cur?.refCount ?? 0,
      });
      return { streams: next };
    });
  }
}
