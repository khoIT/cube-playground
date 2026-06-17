/**
 * The interactive Cube proxy polls Cube's continue-wait protocol so a cold
 * pre-agg / raw read warms across several 25s windows instead of being handed
 * back as a 30s single-shot 504. These tests cover the loop in isolation
 * (stubbed fetch) — no full app/auth harness needed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isContinueWait,
  forwardLoadWithContinueWait,
} from '../src/routes/cube-proxy.js';

const TARGET = { cubeApiUrl: 'http://cube.test', token: null };

/** Minimal stand-in for a fetch Response as `forward()` consumes it. */
function res(status: number, body: unknown) {
  return { status, text: async () => JSON.stringify(body) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isContinueWait', () => {
  it('is true only for a 200 carrying Cube\'s warming signal', () => {
    expect(isContinueWait(200, { error: 'Continue wait' })).toBe(true);
    expect(isContinueWait(200, { error: 'continue wait' })).toBe(true);
  });

  it('is false for data, non-200, or non-string errors', () => {
    expect(isContinueWait(200, { data: [{ x: 1 }] })).toBe(false);
    expect(isContinueWait(500, { error: 'Continue wait' })).toBe(false); // not a 200
    expect(isContinueWait(200, { error: { msg: 'Continue wait' } })).toBe(false);
    expect(isContinueWait(200, null)).toBe(false);
  });
});

describe('forwardLoadWithContinueWait', () => {
  it('returns on the first fetch when the query is already warm', async () => {
    const fetchMock = vi.fn(async () => res(200, { data: [{ n: 1 }] }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await forwardLoadWithContinueWait(TARGET, 'POST', '', { query: {} });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ status: 200, body: { data: [{ n: 1 }] } });
  });

  it('polls past a Continue wait and returns the data once warm', async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      return call < 2 ? res(200, { error: 'Continue wait' }) : res(200, { data: [{ n: 2 }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await forwardLoadWithContinueWait(TARGET, 'GET', 'query=%7B%7D', undefined);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ status: 200, body: { data: [{ n: 2 }] } });
  });

  it('passes a non-200 error straight back without looping', async () => {
    const fetchMock = vi.fn(async () => res(400, { error: 'bad query' }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await forwardLoadWithContinueWait(TARGET, 'POST', '', { query: {} });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ status: 400, body: { error: 'bad query' } });
  });
});
