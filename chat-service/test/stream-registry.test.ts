/**
 * stream-registry tests — covers ring overflow, TTL eviction, listener fan-out,
 * concurrent-turn cap, and compact-session alias resolution.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  createStreamRegistry,
  RegistryOverflowError,
  type StreamRegistry,
} from '../src/core/stream-registry.js';
import type { SseEvent } from '../src/types.js';

let reg: StreamRegistry | null = null;

afterEach(() => {
  reg?.dispose();
  reg = null;
});

function tokenEvent(delta: string): SseEvent {
  return { type: 'token', data: { delta } };
}

describe('stream-registry — happy path', () => {
  it('register → append → get returns buffered events', () => {
    reg = createStreamRegistry({
      ringSize: 100,
      maxTurns: 10,
      ttlMs: 60_000,
      sweepIntervalMs: 60_000,
    });
    reg.register('t1', 'sess-1');
    reg.append('t1', tokenEvent('A'));
    reg.append('t1', tokenEvent('B'));

    const entry = reg.get('t1');
    expect(entry?.events.map((e) => (e.data as { delta: string }).delta)).toEqual(['A', 'B']);
    expect(entry?.totalEmitted).toBe(2);
    expect(entry?.startOffset).toBe(0);
  });
});

describe('stream-registry — ring overflow', () => {
  it('drops oldest events and bumps startOffset', () => {
    reg = createStreamRegistry({
      ringSize: 3,
      maxTurns: 10,
      ttlMs: 60_000,
      sweepIntervalMs: 60_000,
    });
    reg.register('t1', 'sess-1');
    for (let i = 0; i < 5; i++) reg.append('t1', tokenEvent(String(i)));

    const entry = reg.get('t1')!;
    expect(entry.events.length).toBe(3);
    expect(entry.events.map((e) => (e.data as { delta: string }).delta)).toEqual(['2', '3', '4']);
    expect(entry.startOffset).toBe(2);
    expect(entry.totalEmitted).toBe(5);
  });
});

describe('stream-registry — listener fan-out', () => {
  it('subscribers receive subsequent events, not buffered ones', () => {
    reg = createStreamRegistry({
      ringSize: 10,
      maxTurns: 10,
      ttlMs: 60_000,
      sweepIntervalMs: 60_000,
    });
    reg.register('t1', 'sess-1');
    reg.append('t1', tokenEvent('A'));

    const received: string[] = [];
    const unsubscribe = reg.subscribe('t1', (ev) => {
      if (ev.type === 'token') received.push(ev.data.delta);
    });

    reg.append('t1', tokenEvent('B'));
    reg.append('t1', tokenEvent('C'));
    unsubscribe();
    reg.append('t1', tokenEvent('D'));

    expect(received).toEqual(['B', 'C']);
  });

  it('subscribe on a finished entry returns a no-op unsubscribe', () => {
    reg = createStreamRegistry({
      ringSize: 10,
      maxTurns: 10,
      ttlMs: 60_000,
      sweepIntervalMs: 60_000,
    });
    reg.register('t1', 'sess-1');
    reg.finish('t1', 'done');
    const received: SseEvent[] = [];
    const unsub = reg.subscribe('t1', (ev) => received.push(ev));
    reg.append('t1', tokenEvent('X'));
    unsub();
    expect(received).toEqual([]);
  });
});

describe('stream-registry — concurrent-turn cap', () => {
  it('register throws once maxTurns running', () => {
    reg = createStreamRegistry({
      ringSize: 10,
      maxTurns: 2,
      ttlMs: 60_000,
      sweepIntervalMs: 60_000,
    });
    reg.register('t1', 'sess-1');
    reg.register('t2', 'sess-2');
    expect(() => reg!.register('t3', 'sess-3')).toThrow(RegistryOverflowError);
  });

  it('finished entries do not block fresh turns', () => {
    reg = createStreamRegistry({
      ringSize: 10,
      maxTurns: 2,
      ttlMs: 60_000,
      sweepIntervalMs: 60_000,
    });
    reg.register('t1', 'sess-1');
    reg.register('t2', 'sess-2');
    reg.finish('t1', 'done');
    // Now we can register a 3rd because only 1 is running.
    expect(() => reg!.register('t3', 'sess-3')).not.toThrow();
  });
});

describe('stream-registry — alias resolution (compact)', () => {
  it('findRunning(oldSessionId) returns the entry registered under newSessionId', () => {
    reg = createStreamRegistry({
      ringSize: 10,
      maxTurns: 10,
      ttlMs: 60_000,
      sweepIntervalMs: 60_000,
    });
    reg.aliasSession('sess-old', 'sess-new');
    reg.register('t1', 'sess-new');

    const found = reg.findRunning('sess-old');
    expect(found?.turnId).toBe('t1');
    expect(found?.sessionId).toBe('sess-new');
  });

  it('findRunning returns undefined for unknown sessions', () => {
    reg = createStreamRegistry({
      ringSize: 10,
      maxTurns: 10,
      ttlMs: 60_000,
      sweepIntervalMs: 60_000,
    });
    expect(reg.findRunning('nope')).toBeUndefined();
  });

  it('aliasSession applied after register also bumps existing entry.sessionId', () => {
    reg = createStreamRegistry({
      ringSize: 10,
      maxTurns: 10,
      ttlMs: 60_000,
      sweepIntervalMs: 60_000,
    });
    reg.register('t1', 'sess-old');
    reg.aliasSession('sess-old', 'sess-new');
    expect(reg.get('t1')?.sessionId).toBe('sess-new');
    expect(reg.findRunning('sess-old')?.turnId).toBe('t1');
    expect(reg.findRunning('sess-new')?.turnId).toBe('t1');
  });
});

describe('stream-registry — TTL eviction', () => {
  it('finished entries are removed after ttlMs', async () => {
    reg = createStreamRegistry({
      ringSize: 10,
      maxTurns: 10,
      ttlMs: 10,
      sweepIntervalMs: 5,
    });
    reg.register('t1', 'sess-1');
    reg.finish('t1', 'done');
    // Wait long enough for at least one sweep beyond TTL.
    await new Promise((r) => setTimeout(r, 50));
    expect(reg.get('t1')).toBeUndefined();
  });

  it('running entries are NOT evicted by the sweeper (within maxRunningMs)', async () => {
    reg = createStreamRegistry({
      ringSize: 10,
      maxTurns: 10,
      ttlMs: 10,
      sweepIntervalMs: 5,
    });
    reg.register('t1', 'sess-1');
    await new Promise((r) => setTimeout(r, 30));
    expect(reg.get('t1')).toBeDefined();
  });
});

describe('stream-registry — leaked running-entry reaper', () => {
  it('reaps a never-finished running entry past maxRunningMs and frees the cap', async () => {
    // A turn that throws before its streaming finally can call finish() stays
    // 'running' forever — without the reaper it counts against the cap for good.
    reg = createStreamRegistry({
      ringSize: 10,
      maxTurns: 2,
      ttlMs: 60_000,
      sweepIntervalMs: 5,
      maxRunningMs: 10,
    });
    reg.register('leaked', 'sess-leaked'); // simulated leak: never finished
    await new Promise((r) => setTimeout(r, 40)); // > maxRunningMs + a sweep

    expect(reg.get('leaked')).toBeUndefined(); // reaped
    // Cap is no longer wedged — two fresh turns register without overflow.
    expect(() => {
      reg!.register('t2', 'sess-2');
      reg!.register('t3', 'sess-3');
    }).not.toThrow();
  });
});

describe('stream-registry — alias survives a sibling turn (R28)', () => {
  it('keeps a compact alias still needed by another live turn on the same session', async () => {
    reg = createStreamRegistry({
      ringSize: 10,
      maxTurns: 10,
      ttlMs: 10,
      sweepIntervalMs: 5,
      maxRunningMs: 60_000,
    });
    // A client still holding the pre-compact id resolves via this alias.
    reg.aliasSession('sess-old', 'sess-new');
    reg.register('t1', 'sess-new'); // first turn (will finish + be swept)
    reg.register('t2', 'sess-new'); // sibling turn, still live on the same session
    reg.finish('t1', 'done');

    await new Promise((r) => setTimeout(r, 40)); // t1 evicted past ttl, t2 stays

    expect(reg.get('t1')).toBeUndefined();
    // The alias must NOT have been collateral-deleted: a client on the old id
    // still resolves to the live sibling turn.
    expect(reg.findRunning('sess-old')?.turnId).toBe('t2');
  });

  it('drops a fully orphaned alias once no entry references it', async () => {
    reg = createStreamRegistry({
      ringSize: 10,
      maxTurns: 10,
      ttlMs: 10,
      sweepIntervalMs: 5,
      maxRunningMs: 60_000,
    });
    reg.aliasSession('sess-old', 'sess-new');
    reg.register('t1', 'sess-new');
    reg.finish('t1', 'done');

    await new Promise((r) => setTimeout(r, 40)); // t1 evicted; nothing left on sess-new

    expect(reg.get('t1')).toBeUndefined();
    expect(reg.findRunning('sess-old')).toBeUndefined(); // orphan alias pruned
  });
});
