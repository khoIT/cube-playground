/**
 * Admission control for the /load proxy path: per-actor + global in-flight
 * caps, in-flight dedup, and disconnect-aware abort. Exercised in isolation
 * with controllable "upstream" promises — no app/auth harness needed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  admitLoad,
  admissionSnapshot,
  LoadAdmissionRejected,
  __resetAdmissionForTest,
  type LoadResult,
} from '../src/routes/cube-load-admission.js';

beforeEach(() => __resetAdmissionForTest());

/** A run() whose resolution we control, capturing the abort signal it gets. */
function deferredRun() {
  let resolve!: (r: LoadResult) => void;
  const promise = new Promise<LoadResult>((r) => (resolve = r));
  const captured: { signal?: AbortSignal } = {};
  const run = (signal: AbortSignal) => {
    captured.signal = signal;
    return promise;
  };
  return { run, resolve, captured };
}

const OK: LoadResult = { status: 200, body: { data: [] } };

describe('admitLoad — concurrency caps', () => {
  it('rejects a NEW query over the per-owner cap, not followers', async () => {
    const owner = 'u1';
    // Drive off the configured cap so the test survives default/env changes.
    const cap = admissionSnapshot().maxPerOwner;
    const started: ReturnType<typeof deferredRun>[] = [];
    // Fill the per-owner cap with distinct keys.
    for (let i = 0; i < cap; i++) {
      const d = deferredRun();
      started.push(d);
      void admitLoad({ ownerId: owner, dedupKey: `k${i}`, clientSignal: new AbortController().signal, run: d.run });
    }
    expect(admissionSnapshot().globalInFlight).toBe(cap);
    // One past the cap, same owner, DISTINCT query → rejected.
    expect(() =>
      admitLoad({ ownerId: owner, dedupKey: `k${cap}`, clientSignal: new AbortController().signal, run: deferredRun().run }),
    ).toThrow(LoadAdmissionRejected);
    // Settling one frees a slot (release runs in the admitLoad .finally chain).
    started[0].resolve(OK);
    await Promise.resolve();
    await Promise.resolve();
    expect(admissionSnapshot().globalInFlight).toBe(cap - 1);
  });

  it('rejects over the global cap across owners', async () => {
    // Drive off the configured cap; spread across owners so per-owner never trips.
    const cap = admissionSnapshot().maxGlobal;
    const ds: ReturnType<typeof deferredRun>[] = [];
    for (let i = 0; i < cap; i++) {
      const d = deferredRun();
      ds.push(d);
      void admitLoad({ ownerId: `owner${i}`, dedupKey: `g${i}`, clientSignal: new AbortController().signal, run: d.run });
    }
    expect(admissionSnapshot().globalInFlight).toBe(cap);
    let scope: string | undefined;
    try {
      admitLoad({ ownerId: 'owner-new', dedupKey: `g${cap}`, clientSignal: new AbortController().signal, run: deferredRun().run });
    } catch (e) {
      scope = (e as LoadAdmissionRejected).scope;
    }
    expect(scope).toBe('global');
  });
});

describe('admitLoad — dedup', () => {
  it('coalesces identical in-flight queries into ONE upstream, no extra slot', async () => {
    const d = deferredRun();
    let runCalls = 0;
    const countingRun = (sig: AbortSignal) => {
      runCalls++;
      return d.run(sig);
    };
    const p1 = admitLoad({ ownerId: 'u', dedupKey: 'same', clientSignal: new AbortController().signal, run: countingRun });
    const p2 = admitLoad({ ownerId: 'u', dedupKey: 'same', clientSignal: new AbortController().signal, run: countingRun });
    expect(runCalls).toBe(1); // follower reused the leader's upstream
    expect(admissionSnapshot().globalInFlight).toBe(1); // follower consumed no slot
    d.resolve(OK);
    expect(await p1).toEqual(OK);
    expect(await p2).toEqual(OK);
  });
});

describe('admitLoad — disconnect-aware abort', () => {
  it('aborts the upstream only when the LAST interested client disconnects', async () => {
    const d = deferredRun();
    const c1 = new AbortController();
    const c2 = new AbortController();
    void admitLoad({ ownerId: 'u', dedupKey: 'shared', clientSignal: c1.signal, run: d.run });
    void admitLoad({ ownerId: 'u', dedupKey: 'shared', clientSignal: c2.signal, run: d.run });

    c1.abort(); // one client leaves — upstream must keep running for the other
    expect(d.captured.signal?.aborted).toBe(false);

    c2.abort(); // last client leaves — now abort upstream
    expect(d.captured.signal?.aborted).toBe(true);
  });

  it('releases the slot when the upstream settles', async () => {
    const d = deferredRun();
    void admitLoad({ ownerId: 'u', dedupKey: 'one', clientSignal: new AbortController().signal, run: d.run });
    expect(admissionSnapshot().distinctInflight).toBe(1);
    d.resolve(OK);
    await Promise.resolve();
    await Promise.resolve();
    expect(admissionSnapshot().distinctInflight).toBe(0);
    expect(admissionSnapshot().globalInFlight).toBe(0);
  });
});
