/**
 * Exercises the runtime loop with a STUBBED query() (no real SDK / OAuth): the
 * multi-turn loop, single done per turn, timeout-interrupt keeping the session
 * resumable, session abort, and budget exhaustion. The precise live SDK
 * interrupt→resume behavior is verified separately by the OAuth smoke on a
 * token-bearing host; here we pin our own control flow.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createAdvisorAgentSession,
  type AgentQueryFn,
  type AdvisorAgentSession,
} from '../src/advisor/agent/agent-runtime.js';
import type { SessionOpts, RuntimeEvent } from '../src/advisor/agent/agent-types.js';
import { noopRunRecorder } from '../src/advisor/agent/run-recorder.js';

type FakeMode = 'ok' | 'hang' | 'expensive';

function makeFake(mode: FakeMode): { queryFn: AgentQueryFn; calls: { count: number } } {
  const calls = { count: 0 };
  let resolveHang: (() => void) | null = null;
  const interrupt = async (): Promise<void> => {
    resolveHang?.();
    resolveHang = null;
  };
  const queryFn: AgentQueryFn = ({ prompt }) => {
    calls.count += 1;
    async function* gen(): AsyncGenerator<unknown> {
      for await (const _user of prompt) {
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } };
        if (mode === 'hang') {
          await new Promise<void>((r) => {
            resolveHang = r;
          });
          return; // interrupted → current turn ends without a result
        }
        yield { type: 'result', subtype: 'success', total_cost_usd: mode === 'expensive' ? 2.0 : 0.01 };
      }
    }
    const g = gen() as AsyncGenerator<unknown> & { interrupt?: () => Promise<void> };
    g.interrupt = interrupt;
    return g;
  };
  return { queryFn, calls };
}

const BASE_OPTS: SessionOpts = {
  scope: { kind: 'segment', segmentId: 'seg-x', gameId: 'cfm_vn' },
  goal: 'revenue',
  ctx: { cubeApiUrl: 'http://stub', token: null },
};

async function collect(gen: AsyncGenerator<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const out: RuntimeEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

beforeEach(() => {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token';
});
afterEach(() => {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
});

describe('createAdvisorAgentSession.runTurn', () => {
  it('streams a happy turn ending in exactly one done', async () => {
    const { queryFn } = makeFake('ok');
    const s = createAdvisorAgentSession('s1', BASE_OPTS, undefined, { queryFn, recorder: noopRunRecorder });
    const events = await collect(s.runTurn('why are payers churning?', 'drive'));
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1);
    expect(events.find((e) => e.type === 'done')).toMatchObject({ stopReason: 'end_turn' });
    expect(events.some((e) => e.type === 'assistant_delta')).toBe(true);
    expect(events.some((e) => e.type === 'cost')).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(s.busy).toBe(false);
  });

  it('reuses one query across multiple turns', async () => {
    const { queryFn, calls } = makeFake('ok');
    const s = createAdvisorAgentSession('s2', BASE_OPTS, undefined, { queryFn, recorder: noopRunRecorder });
    await collect(s.runTurn('q1', 'drive'));
    await collect(s.runTurn('q2', 'steer'));
    expect(calls.count).toBe(1);
    expect(s.turnIndex).toBe(2);
  });

  it('timeout interrupts the turn but keeps the session resumable', async () => {
    const { queryFn } = makeFake('hang');
    const s = createAdvisorAgentSession('s3', { ...BASE_OPTS, caps: { timeoutMs: 15 } }, undefined, { queryFn, recorder: noopRunRecorder });
    const events = await collect(s.runTurn('dig in', 'drive'));
    expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'timeout' });
    expect(events.find((e) => e.type === 'done')).toMatchObject({ stopReason: 'timeout' });
    expect(s.isClosed()).toBe(false); // NOT closed — resume allowed
  });

  it('budget exhaustion closes the session', async () => {
    const { queryFn } = makeFake('expensive');
    const s = createAdvisorAgentSession('s4', { ...BASE_OPTS, caps: { maxBudgetUsd: 1.0 } }, undefined, { queryFn, recorder: noopRunRecorder });
    await collect(s.runTurn('hi', 'drive'));
    expect(s.totalCostUsd).toBe(2.0);
    expect(s.isClosed()).toBe(true);
  });

  it('abort() closes the session; a further turn is refused immediately', async () => {
    const { queryFn } = makeFake('ok');
    const s: AdvisorAgentSession = createAdvisorAgentSession('s5', BASE_OPTS, undefined, { queryFn, recorder: noopRunRecorder });
    s.abort('evicted');
    expect(s.isClosed()).toBe(true);
    const events = await collect(s.runTurn('hi', 'drive'));
    expect(events).toEqual([
      { type: 'error', code: 'aborted', message: 'session is closed' },
      { type: 'done', usd: null, stopReason: 'aborted' },
    ]);
  });

  it('fails fast (throws) when the OAuth token is absent', () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const { queryFn } = makeFake('ok');
    expect(() => createAdvisorAgentSession('s6', BASE_OPTS, undefined, { queryFn, recorder: noopRunRecorder })).toThrow();
  });
});
