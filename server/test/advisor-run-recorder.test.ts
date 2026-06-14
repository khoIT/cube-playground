/**
 * Runtime → RunRecorder instrumentation. Drives the runtime loop with a STUBBED
 * query() and a capturing recorder (no real SDK / OAuth / DB):
 *   - a happy turn persists run + turn + tool calls + events
 *   - a cube_query left open when the turn times out is recorded as failed with
 *     a duration (the cold-Trino failure mode the console exists to debug)
 *   - a recorder that throws never breaks the turn's SSE or stop reason
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAdvisorAgentSession, type AgentQueryFn } from '../src/advisor/agent/agent-runtime.js';
import type { SessionOpts, RuntimeEvent } from '../src/advisor/agent/agent-types.js';
import type { RunRecorder, TurnFlush } from '../src/advisor/agent/run-recorder.js';

const BASE_OPTS: SessionOpts = {
  scope: { kind: 'segment', segmentId: 'seg-x', gameId: 'cfm_vn' },
  goal: 'revenue',
  ctx: { cubeApiUrl: 'http://stub', token: null },
  owner: 'analyst@corp.com',
};

function capturing(): { recorder: RunRecorder; flushes: TurnFlush[] } {
  const flushes: TurnFlush[] = [];
  return { recorder: { flushTurn: (f) => flushes.push(f) }, flushes };
}

/** Happy turn: text + cube_query tool_use + ok tool_result + success result. */
const happyQuery: AgentQueryFn = ({ prompt }) => {
  async function* gen(): AsyncGenerator<unknown> {
    for await (const _user of prompt) {
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'investigating' },
            { type: 'tool_use', name: 'cube_query', id: 'tc1', input: { measures: ['revenue'] } },
          ],
        },
      };
      yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tc1', is_error: false, content: 'rows: 12' }] } };
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.02 };
    }
  }
  return gen() as AsyncGenerator<unknown>;
};

/** A cube_query is started but no tool_result arrives; the gen hangs until interrupt. */
function makeHangAfterToolUse(): AgentQueryFn {
  let resolveHang: (() => void) | null = null;
  const interrupt = async (): Promise<void> => {
    resolveHang?.();
    resolveHang = null;
  };
  const fn: AgentQueryFn = ({ prompt }) => {
    async function* gen(): AsyncGenerator<unknown> {
      for await (const _user of prompt) {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'cube_query', id: 'tc9', input: { measures: ['dau'] } }] },
        };
        await new Promise<void>((r) => {
          resolveHang = r;
        });
        return; // interrupted → turn ends without a tool_result/result
      }
    }
    const g = gen() as AsyncGenerator<unknown> & { interrupt?: () => Promise<void> };
    g.interrupt = interrupt;
    return g;
  };
  return fn;
}

async function collect(gen: AsyncGenerator<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const out: RuntimeEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('runtime → RunRecorder', () => {
  beforeEach(() => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token';
  });
  afterEach(() => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  });

  it('persists run + turn + tool calls + events for a happy turn', async () => {
    const { recorder, flushes } = capturing();
    const s = createAdvisorAgentSession('rec-1', BASE_OPTS, undefined, { queryFn: happyQuery, recorder });
    await collect(s.runTurn('why is revenue down?', 'drive'));

    expect(flushes).toHaveLength(1);
    const f = flushes[0];
    expect(f.run).toMatchObject({ sessionId: 'rec-1', gameId: 'cfm_vn', segmentId: 'seg-x', scopeKind: 'segment', owner: 'analyst@corp.com', finalStopReason: 'end_turn', hadError: false });
    expect(f.turn).toMatchObject({ turnIndex: 1, stopReason: 'end_turn', message: 'why is revenue down?' });
    expect(f.turn.narration).toContain('investigating');

    const cube = f.toolCalls.find((c) => c.tool === 'cube_query');
    expect(cube).toBeDefined();
    expect(cube!.state).toBe('ok');
    expect(cube!.inputJson).toContain('revenue'); // input threaded through
    expect(cube!.durationMs).toBeGreaterThanOrEqual(0);

    const types = f.events.map((e) => e.eventType);
    expect(types).toContain('assistant_delta');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('done');
  });

  it('records an interrupted cube_query as failed with a duration on timeout', async () => {
    const { recorder, flushes } = capturing();
    const s = createAdvisorAgentSession('rec-2', { ...BASE_OPTS, caps: { timeoutMs: 15 } }, undefined, {
      queryFn: makeHangAfterToolUse(),
      recorder,
    });
    const events = await collect(s.runTurn('dig in', 'drive'));

    expect(events.find((e) => e.type === 'done')).toMatchObject({ stopReason: 'timeout' });
    expect(flushes).toHaveLength(1);
    const f = flushes[0];
    expect(f.run.finalStopReason).toBe('timeout');
    expect(f.run.hadError).toBe(true);

    const cube = f.toolCalls.find((c) => c.tool === 'cube_query');
    expect(cube).toBeDefined();
    expect(cube!.state).toBe('failed');
    expect(cube!.errorMessage).toContain('interrupted');
    expect(cube!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('a recorder that throws never breaks the turn', async () => {
    const throwing: RunRecorder = {
      flushTurn() {
        throw new Error('boom');
      },
    };
    const s = createAdvisorAgentSession('rec-3', BASE_OPTS, undefined, { queryFn: happyQuery, recorder: throwing });
    const events = await collect(s.runTurn('hi', 'drive'));
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1);
    expect(events.find((e) => e.type === 'done')).toMatchObject({ stopReason: 'end_turn' });
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });
});
