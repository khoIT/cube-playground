/**
 * LLM-suggester tests: prompt contains NAMES only (no values); timeout → error
 * (not throw); per-id cache prevents a 2nd call; per-admin rate-limit kicks in.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  suggestViaLlm,
  buildLlmPrompt,
  __resetLlmSuggesterState,
  type GatewayCall,
} from '../src/services/query-perf-llm-suggester.js';
import type { Verdict } from '../src/services/query-perf-classifier.js';
import type { QueryShape } from '../src/services/query-perf-store.js';

const verdict: Verdict = { preaggHit: 'miss', matchability: 'matchable', reason: 'odd shape' };
const shape: QueryShape = { cubes: ['mf_users'], measures: ['mf_users.count'], dimensions: ['mf_users.country'] };

beforeEach(() => { __resetLlmSuggesterState(); });

describe('buildLlmPrompt', () => {
  it('carries NAMES + verdict only — no filter values or UIDs possible', () => {
    const p = buildLlmPrompt(verdict, shape);
    expect(p).toContain('mf_users.count');
    expect(p).toContain('mf_users.country');
    expect(p).toContain('matchability=matchable');
    // shape has no values to leak; assert the prompt is built purely from shape.
    expect(p).not.toContain('uid');
  });
});

describe('suggestViaLlm', () => {
  const okGateway: GatewayCall = async () => 'Add a rollup on log_date.';

  it('returns the suggestion + lane on success', async () => {
    const r = await suggestViaLlm(verdict, shape, { id: 1, actorSub: 'a', gateway: okGateway });
    expect(r).toEqual({ suggestion: 'Add a rollup on log_date.', lane: 'gateway' });
  });

  it('caches per id — a 2nd call does not invoke the gateway again', async () => {
    let calls = 0;
    const counting: GatewayCall = async () => { calls++; return 'cached'; };
    await suggestViaLlm(verdict, shape, { id: 7, actorSub: 'a', gateway: counting });
    await suggestViaLlm(verdict, shape, { id: 7, actorSub: 'a', gateway: counting });
    expect(calls).toBe(1);
  });

  it('rate-limits per admin after the bucket drains', async () => {
    const g: GatewayCall = async () => 'ok';
    let lastErr: unknown = null;
    // Distinct ids so the cache never short-circuits; same actor drains the bucket.
    for (let i = 0; i < 7; i++) {
      lastErr = await suggestViaLlm(verdict, shape, { id: 100 + i, actorSub: 'spammer', gateway: g, now: 1_000 });
    }
    expect(lastErr).toEqual({ error: 'rate_limited' });
  });

  it('maps an abort to {error: llm_timeout} — never throws', async () => {
    const aborting: GatewayCall = async (_p, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
        // never resolves on its own
      });
    // Force immediate abort via a tiny timeout override is internal; instead
    // simulate by aborting through a 0ms env is not exposed — use a gateway
    // that rejects with AbortError directly.
    const r = await suggestViaLlm(verdict, shape, { id: 200, actorSub: 'a', gateway: async (_p, s) => {
      const e = new Error('aborted'); e.name = 'AbortError'; throw e;
    } });
    expect(r).toEqual({ error: 'llm_timeout' });
    void aborting;
  });

  it('maps a gateway error to {error} without throwing', async () => {
    const r = await suggestViaLlm(verdict, shape, { id: 300, actorSub: 'a', gateway: async () => { throw new Error('gateway_503'); } });
    expect(r).toEqual({ error: 'gateway_503' });
  });
});
