/**
 * In-memory registry of active streaming turns.
 *
 * Each entry holds a bounded ring buffer of SSE events plus a set of live
 * listeners. The registry powers refresh-resume (Phase 6 replay endpoint):
 * a refreshed client requests events `from=<offset>`; the registry serves
 * buffered events first, then attaches the client as a listener for the
 * live tail.
 *
 * Lifecycle:
 *   register(turnId, sessionId) → entry inserted
 *   append(turnId, event)       → push into ring, fan out to listeners
 *   subscribe(turnId, listener) → returns unsubscribe; receives subsequent
 *                                 events until finish or unsubscribe
 *   finish(turnId, status)      → marks terminal; ring retained for TTL
 *   aliasSession(old, new)      → tracks compact-session swap (Q1)
 *   findRunning(sessionId)      → returns the running entry, resolving alias
 *
 * Memory: bounded by `STREAM_REGISTRY_RING_SIZE` per turn (default 2000) and
 * `STREAM_REGISTRY_MAX_TURNS` globally (default 100). A background sweeper
 * drops finished entries after TTL.
 */

import type { SseEvent } from '../types.js';

export type AbortReason = 'user_cancel' | 'timeout' | 'server_error';

export interface RegistryEntry {
  turnId: string;
  /** Current sessionId (post-compact alias resolution). */
  sessionId: string;
  status: 'running' | 'done' | 'error';
  /** Ring of recent events; oldest dropped when length === ringSize. */
  events: SseEvent[];
  /** Count of events dropped from the head (so absolute offset math works). */
  startOffset: number;
  /** Total events ever emitted on this turn. */
  totalEmitted: number;
  createdAt: number;
  finishedAt?: number;
  listeners: Set<(event: SseEvent) => void>;
  /**
   * Phase 04 — abort controller for this turn. When the cancel endpoint or
   * timeout timer fires, the registry calls controller.abort() with the
   * reason captured separately on `abortReason`.
   */
  controller?: AbortController;
  abortReason?: AbortReason;
}

export interface StreamRegistryConfig {
  ringSize: number;
  maxTurns: number;
  ttlMs: number;
  sweepIntervalMs: number;
  /**
   * Max age (ms) a 'running' entry may live before the sweeper reaps it as a
   * leak. Optional so hermetic tests can omit it; defaults generously so it
   * never reaps a live turn.
   */
  maxRunningMs?: number;
}

/** Default leak-reaper threshold when config omits maxRunningMs (30 min). */
const DEFAULT_MAX_RUNNING_MS = 30 * 60 * 1000;

export class RegistryOverflowError extends Error {
  readonly code = 'registry_overflow' as const;
  constructor(maxTurns: number) {
    super(`Stream registry full (max ${maxTurns} concurrent turns)`);
    this.name = 'RegistryOverflowError';
  }
}

export interface StreamRegistry {
  register(turnId: string, sessionId: string, controller?: AbortController): RegistryEntry;
  append(turnId: string, event: SseEvent): void;
  finish(turnId: string, status: 'done' | 'error'): void;
  get(turnId: string): RegistryEntry | undefined;
  subscribe(turnId: string, listener: (event: SseEvent) => void): () => void;
  /** Record a sessionId swap (compact). New sessionId resolves to the same entry. */
  aliasSession(oldSessionId: string, newSessionId: string): void;
  /** Return the running entry for the given sessionId, resolving aliases. */
  findRunning(sessionId: string): RegistryEntry | undefined;
  /**
   * Phase 04 — request abort on the turn's controller. Returns true if the
   * turn was running and the abort was signalled; false if the turn was
   * unknown or already finished (race: cancel arrived after natural
   * completion).
   */
  abort(turnId: string, reason: AbortReason): boolean;
  /** For test teardown — stops the sweeper and clears state. */
  dispose(): void;
}

export function createStreamRegistry(config: StreamRegistryConfig): StreamRegistry {
  const entries = new Map<string, RegistryEntry>();
  // Forward alias chain: oldSessionId → currentSessionId of the same turn.
  const aliases = new Map<string, string>();

  function resolveSessionId(sessionId: string): string {
    let resolved = sessionId;
    const seen = new Set<string>();
    while (aliases.has(resolved)) {
      if (seen.has(resolved)) break; // cycle guard (shouldn't happen)
      seen.add(resolved);
      resolved = aliases.get(resolved)!;
    }
    return resolved;
  }

  function register(turnId: string, sessionId: string, controller?: AbortController): RegistryEntry {
    // Count only RUNNING entries against the cap — finished entries linger
    // inside the TTL window but shouldn't block fresh turns.
    let running = 0;
    for (const e of entries.values()) {
      if (e.status === 'running') running++;
    }
    if (running >= config.maxTurns) {
      throw new RegistryOverflowError(config.maxTurns);
    }
    const entry: RegistryEntry = {
      turnId,
      sessionId,
      status: 'running',
      events: [],
      startOffset: 0,
      totalEmitted: 0,
      createdAt: Date.now(),
      listeners: new Set(),
      ...(controller ? { controller } : {}),
    };
    entries.set(turnId, entry);
    return entry;
  }

  function abort(turnId: string, reason: AbortReason): boolean {
    const entry = entries.get(turnId);
    if (!entry || entry.status !== 'running') return false;
    entry.abortReason = reason;
    if (entry.controller && !entry.controller.signal.aborted) {
      entry.controller.abort(reason);
    }
    return true;
  }

  function append(turnId: string, event: SseEvent): void {
    const entry = entries.get(turnId);
    if (!entry) return;
    entry.events.push(event);
    entry.totalEmitted += 1;
    if (entry.events.length > config.ringSize) {
      const dropped = entry.events.length - config.ringSize;
      entry.events.splice(0, dropped);
      entry.startOffset += dropped;
    }
    // Track sessionId changes from session_created / compact_warning so
    // findRunning() can find the entry post-rename. Always record an alias
    // before mutating entry.sessionId — defense-in-depth in case any caller
    // ever holds the pre-event sessionId (today register() is invoked after
    // session_created, so this branch is mostly dead-code, but cheap).
    if (event.type === 'session_created' && event.data.id !== entry.sessionId) {
      aliases.set(entry.sessionId, event.data.id);
      entry.sessionId = event.data.id;
    } else if (event.type === 'compact_warning' && event.data.to !== entry.sessionId) {
      aliases.set(entry.sessionId, event.data.to);
      entry.sessionId = event.data.to;
    }
    for (const listener of entry.listeners) {
      try {
        listener(event);
      } catch {
        /* listener errors must not break the loop */
      }
    }
  }

  function finish(turnId: string, status: 'done' | 'error'): void {
    const entry = entries.get(turnId);
    if (!entry) return;
    entry.status = status;
    entry.finishedAt = Date.now();
    // Drop listeners — the entry stays in the ring for TTL but no new events
    // will arrive.
    entry.listeners.clear();
  }

  function get(turnId: string): RegistryEntry | undefined {
    return entries.get(turnId);
  }

  function subscribe(
    turnId: string,
    listener: (event: SseEvent) => void,
  ): () => void {
    const entry = entries.get(turnId);
    if (!entry) return () => {};
    if (entry.status !== 'running') return () => {};
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
    };
  }

  function aliasSession(oldSessionId: string, newSessionId: string): void {
    if (oldSessionId === newSessionId) return;
    aliases.set(oldSessionId, newSessionId);
    // If an entry is currently keyed by oldSessionId, retain the new one.
    // Entries are keyed by turnId, but their `sessionId` field is the
    // source-of-truth for findRunning — bump it too.
    for (const entry of entries.values()) {
      if (entry.sessionId === oldSessionId) {
        entry.sessionId = newSessionId;
      }
    }
  }

  function findRunning(sessionId: string): RegistryEntry | undefined {
    const resolved = resolveSessionId(sessionId);
    for (const entry of entries.values()) {
      if (entry.status === 'running' && entry.sessionId === resolved) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * Drop only aliases no surviving entry still needs. An alias chain
   * `old → … → terminal` is kept while its terminal sessionId is one a live or
   * still-buffered entry is keyed by — so a separate live turn on the same
   * compacted lineage keeps a working resolution path. Fully orphaned chains
   * (terminal no longer present) are removed. Replaces the old "delete every
   * alias touching the swept entry's sessionId", which severed a sibling turn's
   * chain when two turns shared a compacted session.
   */
  function pruneOrphanAliases(): void {
    const liveSessions = new Set<string>();
    for (const e of entries.values()) liveSessions.add(e.sessionId);
    for (const k of [...aliases.keys()]) {
      let cur = k;
      const seen = new Set<string>();
      while (aliases.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        cur = aliases.get(cur)!;
      }
      if (!liveSessions.has(cur)) aliases.delete(k);
    }
  }

  // ---- TTL sweeper -----------------------------------------------------
  const maxRunningMs = config.maxRunningMs ?? DEFAULT_MAX_RUNNING_MS;
  const sweepHandle = setInterval(() => {
    const now = Date.now();
    let removed = false;
    for (const [turnId, entry] of entries) {
      if (entry.status === 'running') {
        // Leak safety net: a turn that threw before its streaming finally could
        // call finish() stays 'running' forever and would count against the
        // concurrency cap indefinitely. Reap entries older than any legitimate
        // turn duration so the cap can't wedge.
        if (now - entry.createdAt > maxRunningMs) {
          entry.status = 'error';
          entry.finishedAt = now;
          entry.listeners.clear();
          entries.delete(turnId);
          removed = true;
        }
        continue;
      }
      if (entry.finishedAt && now - entry.finishedAt > config.ttlMs) {
        entries.delete(turnId);
        removed = true;
      }
    }
    // Prune aliases once, after all deletions, against the surviving set.
    if (removed) pruneOrphanAliases();
  }, config.sweepIntervalMs);
  // Allow process exit even while sweeper is registered.
  sweepHandle.unref?.();

  function dispose(): void {
    clearInterval(sweepHandle);
    entries.clear();
    aliases.clear();
  }

  return {
    register,
    append,
    finish,
    get,
    subscribe,
    aliasSession,
    findRunning,
    abort,
    dispose,
  };
}
