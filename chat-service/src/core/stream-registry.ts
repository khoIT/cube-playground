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
}

export interface StreamRegistryConfig {
  ringSize: number;
  maxTurns: number;
  ttlMs: number;
  sweepIntervalMs: number;
}

export class RegistryOverflowError extends Error {
  readonly code = 'registry_overflow' as const;
  constructor(maxTurns: number) {
    super(`Stream registry full (max ${maxTurns} concurrent turns)`);
    this.name = 'RegistryOverflowError';
  }
}

export interface StreamRegistry {
  register(turnId: string, sessionId: string): RegistryEntry;
  append(turnId: string, event: SseEvent): void;
  finish(turnId: string, status: 'done' | 'error'): void;
  get(turnId: string): RegistryEntry | undefined;
  subscribe(turnId: string, listener: (event: SseEvent) => void): () => void;
  /** Record a sessionId swap (compact). New sessionId resolves to the same entry. */
  aliasSession(oldSessionId: string, newSessionId: string): void;
  /** Return the running entry for the given sessionId, resolving aliases. */
  findRunning(sessionId: string): RegistryEntry | undefined;
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

  function register(turnId: string, sessionId: string): RegistryEntry {
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
    };
    entries.set(turnId, entry);
    return entry;
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
    // findRunning() can find the entry post-rename.
    if (event.type === 'session_created' && event.data.id !== entry.sessionId) {
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

  // ---- TTL sweeper -----------------------------------------------------
  const sweepHandle = setInterval(() => {
    const now = Date.now();
    for (const [turnId, entry] of entries) {
      if (entry.status === 'running') continue;
      if (entry.finishedAt && now - entry.finishedAt > config.ttlMs) {
        entries.delete(turnId);
        // Drop aliases referencing this sessionId.
        for (const [k, v] of aliases) {
          if (v === entry.sessionId || k === entry.sessionId) {
            aliases.delete(k);
          }
        }
      }
    }
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
    dispose,
  };
}
