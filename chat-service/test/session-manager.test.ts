/**
 * session-manager tests: concurrent-turn lock behaviour.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { tryAcquire, TurnInProgressError, _resetForTest } from '../src/core/session-manager.js';

const SESSION = 'test-session-1';

afterEach(() => {
  _resetForTest(SESSION);
});

describe('session-manager', () => {
  it('acquires and releases successfully when not held', async () => {
    const release = await tryAcquire(SESSION);
    expect(typeof release).toBe('function');
    release();
  });

  it('throws TurnInProgressError when lock is already held', async () => {
    const release = await tryAcquire(SESSION);

    try {
      await expect(tryAcquire(SESSION)).rejects.toBeInstanceOf(TurnInProgressError);
    } finally {
      release();
    }
  });

  it('TurnInProgressError has code and retryAfterMs', async () => {
    const release = await tryAcquire(SESSION);

    try {
      await tryAcquire(SESSION);
    } catch (err) {
      expect(err).toBeInstanceOf(TurnInProgressError);
      const e = err as TurnInProgressError;
      expect(e.code).toBe('turn_in_progress');
      expect(e.retryAfterMs).toBeGreaterThan(0);
    } finally {
      release();
    }
  });

  it('lock is re-acquirable after release', async () => {
    const r1 = await tryAcquire(SESSION);
    r1();

    // After release, a new acquire should succeed
    const r2 = await tryAcquire(SESSION);
    expect(typeof r2).toBe('function');
    r2();
  });

  it('different session ids are independent', async () => {
    _resetForTest('session-a');
    _resetForTest('session-b');

    const releaseA = await tryAcquire('session-a');
    // session-b should not be affected
    const releaseB = await tryAcquire('session-b');
    expect(typeof releaseB).toBe('function');

    releaseA();
    releaseB();
    _resetForTest('session-a');
    _resetForTest('session-b');
  });
});
