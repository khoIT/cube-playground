/**
 * Tests for tile-fetch-queue: max-3-concurrent throttle behaviour.
 * Uses fake async tasks (Promises controlled via resolve handles).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Re-import the module fresh per test group to reset module-level state.
// vitest's module isolation is used via vi.resetModules() + dynamic import.

describe('tile-fetch-queue: throttle', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('runs at most 3 concurrent tasks', async () => {
    const { enqueueTileFetch, getRunningCount, getQueueLength } = await import(
      '../tile-fetch-queue'
    );

    const resolvers: Array<() => void> = [];
    // Create 5 tasks that won't resolve until we call their resolver
    const tasks = Array.from({ length: 5 }, () => {
      let res!: () => void;
      const p = new Promise<string>((r) => { res = () => r('done'); });
      resolvers.push(res);
      return () => p;
    });

    const results: string[] = [];
    const promises = tasks.map((t) => enqueueTileFetch(t).then((v) => results.push(v)));

    // Let micro-tasks run so the queue can start tasks
    await Promise.resolve();
    await Promise.resolve();

    // First 3 should be running; 2 should be queued
    expect(getRunningCount()).toBe(3);
    expect(getQueueLength()).toBe(2);

    // Resolve first 3
    resolvers[0]();
    resolvers[1]();
    resolvers[2]();

    // Flush promises
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Next 2 should have started (running ≤ 3 again)
    expect(getRunningCount()).toBeLessThanOrEqual(3);

    // Resolve remaining
    resolvers[3]();
    resolvers[4]();
    await Promise.allSettled(promises);

    expect(results).toHaveLength(5);
  });

  it('propagates task rejections', async () => {
    const { enqueueTileFetch } = await import('../tile-fetch-queue');

    const err = new Error('cube fetch failed');
    const p = enqueueTileFetch(() => Promise.reject(err));

    await expect(p).rejects.toThrow('cube fetch failed');
  });

  it('resolves when task succeeds', async () => {
    const { enqueueTileFetch } = await import('../tile-fetch-queue');

    const result = await enqueueTileFetch(() => Promise.resolve(42));
    expect(result).toBe(42);
  });
});
