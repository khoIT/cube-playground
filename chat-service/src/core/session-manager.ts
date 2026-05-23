/**
 * Per-session async mutex — prevents concurrent turns on the same session.
 * tryAcquire() returns a release fn or throws TurnInProgressError immediately.
 */

import { Mutex, tryAcquire as mutexTryAcquire, E_ALREADY_LOCKED } from 'async-mutex';

export class TurnInProgressError extends Error {
  readonly code = 'turn_in_progress' as const;
  readonly retryAfterMs: number;

  constructor(retryAfterMs = 2000) {
    super('A turn is already in progress for this session');
    this.name = 'TurnInProgressError';
    this.retryAfterMs = retryAfterMs;
  }
}

// Map of sessionId → Mutex. Entries persist for the process lifetime.
const locks = new Map<string, Mutex>();

function getMutex(sessionId: string): Mutex {
  let mutex = locks.get(sessionId);
  if (!mutex) {
    mutex = new Mutex();
    locks.set(sessionId, mutex);
  }
  return mutex;
}

/**
 * Try to acquire the lock for the given sessionId immediately.
 * Returns a release function on success.
 * Throws TurnInProgressError if the lock is already held.
 */
export async function tryAcquire(sessionId: string): Promise<() => void> {
  const mutex = getMutex(sessionId);
  try {
    const release = await mutexTryAcquire(mutex).acquire();
    return release;
  } catch (err) {
    if (err === E_ALREADY_LOCKED) {
      throw new TurnInProgressError(2000);
    }
    throw err;
  }
}

/**
 * Acquire the lock for the given sessionId, waiting if necessary.
 * Returns a release function. Use when you want to queue rather than reject.
 */
export async function acquire(sessionId: string): Promise<() => void> {
  const mutex = getMutex(sessionId);
  return mutex.acquire();
}

/** Exposed for tests only — remove a mutex entry from the map. */
export function _resetForTest(sessionId: string): void {
  locks.delete(sessionId);
}
