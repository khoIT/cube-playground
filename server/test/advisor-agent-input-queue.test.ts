/**
 * The push/pull async queue backing SDK streaming input: it must deliver
 * messages whether pushed before or after the consumer pulls, and signal done
 * on close.
 */
import { describe, it, expect } from 'vitest';
import { AsyncInputQueue } from '../src/advisor/agent/agent-input-queue.js';

describe('AsyncInputQueue', () => {
  it('delivers items pushed before the consumer pulls', async () => {
    const q = new AsyncInputQueue<number>();
    q.push(1);
    q.push(2);
    const it = q[Symbol.asyncIterator]();
    expect(await it.next()).toEqual({ value: 1, done: false });
    expect(await it.next()).toEqual({ value: 2, done: false });
  });

  it('resolves a waiting pull when an item is pushed later', async () => {
    const q = new AsyncInputQueue<string>();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.push('hello');
    expect(await pending).toEqual({ value: 'hello', done: false });
  });

  it('signals done on close, including to a waiting consumer', async () => {
    const q = new AsyncInputQueue<number>();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.close();
    expect(await pending).toMatchObject({ done: true });
    expect(await it.next()).toMatchObject({ done: true });
  });

  it('ignores pushes after close', async () => {
    const q = new AsyncInputQueue<number>();
    q.close();
    q.push(42);
    const it = q[Symbol.asyncIterator]();
    expect(await it.next()).toMatchObject({ done: true });
  });
});
