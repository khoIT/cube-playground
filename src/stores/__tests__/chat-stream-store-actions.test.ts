/**
 * Pure event→state helper tests. Mirrors the legacy reducer regression cases
 * for chat-turn duplication and adds coverage for the 8 SSE event types +
 * status transitions promised in Phase 2 success criteria.
 */
import { describe, it, expect } from 'vitest';
import {
  applySseEvent,
  clearStreamBuffers,
  makeIdleEntry,
  type StreamEntry,
} from '../chat-stream-store-actions';
import type { QueryArtifact, ChartArtifact } from '../../api/chat-sse-client';

function makeArtifact(id: string): QueryArtifact {
  return {
    id,
    title: 't',
    summary: 's',
    query: {},
    source: 'raw',
    deeplinkUrl: '/build',
    deeplinkVia: 'inline',
    payload: {},
  };
}

function makeChart(id: string): ChartArtifact {
  return {
    id,
    truncated: false,
    originalRowCount: 2,
    spec: {
      type: 'bar',
      title: 't',
      data: [
        { k: 'a', v: 1 },
        { k: 'b', v: 2 },
      ],
      encoding: { category: 'k', value: 'v' },
    },
  };
}

function runFullTurn(initial: StreamEntry): StreamEntry {
  let s = initial;
  s = applySseEvent(s, { type: 'loading', data: {} });
  s = applySseEvent(s, { type: 'tool_call', data: { id: 'tc-1', name: 'list_business_metrics', args: {} } });
  s = applySseEvent(s, { type: 'tool_result', data: { id: 'tc-1', ok: true, ms: 12, summary: 'ok' } });
  s = applySseEvent(s, { type: 'token', data: { delta: 'Hello ' } });
  s = applySseEvent(s, { type: 'token', data: { delta: 'world' } });
  s = applySseEvent(s, { type: 'thinking', data: { delta: 'reasoning…' } });
  s = applySseEvent(s, { type: 'query_artifact', data: makeArtifact('a-1') });
  s = applySseEvent(s, { type: 'chart', data: makeChart('c-1') });
  s = applySseEvent(s, { type: 'done', data: {} });
  return s;
}

describe('applySseEvent — happy-path turn', () => {
  it('walks loading → streaming → done and accumulates state', () => {
    const final = runFullTurn(makeIdleEntry('sess-1'));
    expect(final.status).toBe('done');
    expect(final.currentText).toBe('Hello world');
    expect(final.currentReasoning).toBe('reasoning…');
    expect(final.currentArtifacts).toHaveLength(1);
    expect(final.currentCharts).toHaveLength(1);
    expect(final.currentToolCalls).toHaveLength(1);
    expect(final.currentToolCalls[0]?.status).toBe('ok');
    expect(final.currentToolCalls[0]?.summary).toBe('ok');
  });
});

describe('applySseEvent — individual events', () => {
  it('session_created sets sessionId', () => {
    const s = applySseEvent(makeIdleEntry(null), {
      type: 'session_created',
      data: { id: 'sess-x' },
    });
    expect(s.sessionId).toBe('sess-x');
  });

  it('token transitions status to streaming', () => {
    const s = applySseEvent(makeIdleEntry('sess-1'), {
      type: 'token',
      data: { delta: 'hi' },
    });
    expect(s.status).toBe('streaming');
    expect(s.currentText).toBe('hi');
  });

  it('tool_call is deduped by id (idempotent reconnect-friendly)', () => {
    let s = makeIdleEntry('sess-1');
    s = applySseEvent(s, { type: 'tool_call', data: { id: 'tc-1', name: 'f', args: {} } });
    s = applySseEvent(s, { type: 'tool_call', data: { id: 'tc-1', name: 'f', args: {} } });
    expect(s.currentToolCalls).toHaveLength(1);
  });

  it('tool_result updates the matching tool_call', () => {
    let s = makeIdleEntry('sess-1');
    s = applySseEvent(s, { type: 'tool_call', data: { id: 'tc-1', name: 'f', args: {} } });
    s = applySseEvent(s, {
      type: 'tool_result',
      data: { id: 'tc-1', ok: false, ms: 7, summary: 'bad' },
    });
    expect(s.currentToolCalls[0]?.status).toBe('error');
    expect(s.currentToolCalls[0]?.ms).toBe(7);
    expect(s.currentToolCalls[0]?.summary).toBe('bad');
  });

  it('compact_warning advances sessionId and stamps warning', () => {
    const s = applySseEvent(makeIdleEntry('sess-1'), {
      type: 'compact_warning',
      data: { from: 'sess-1', to: 'sess-2', summary: 'compacted' },
    });
    expect(s.sessionId).toBe('sess-2');
    expect(s.lastCompactWarning).toEqual({
      from: 'sess-1',
      to: 'sess-2',
      summary: 'compacted',
    });
  });

  it('result fills currentText only when no streaming tokens arrived', () => {
    let s = makeIdleEntry('sess-1');
    s = applySseEvent(s, {
      type: 'result',
      data: { text: 'final answer' },
    });
    expect(s.currentText).toBe('final answer');

    s = makeIdleEntry('sess-1');
    s = applySseEvent(s, { type: 'token', data: { delta: 'tokens' } });
    s = applySseEvent(s, {
      type: 'result',
      data: { text: 'shouldnt clobber' },
    });
    expect(s.currentText).toBe('tokens');
  });

  it('error event with rate_limited code routes to rate_limited status', () => {
    const s = applySseEvent(makeIdleEntry('sess-1'), {
      type: 'error',
      data: { code: 'rate_limited', message: 'slow down', retry_after_ms: 5000 } as unknown as { code: string; message: string },
    });
    expect(s.status).toBe('rate_limited');
    expect(s.retryAfterMs).toBe(5000);
  });

  it('plain error event sets error status + message', () => {
    const s = applySseEvent(makeIdleEntry('sess-1'), {
      type: 'error',
      data: { code: 'agent_error', message: 'boom' },
    });
    expect(s.status).toBe('error');
    expect(s.error).toBe('boom');
  });

  it('classified error event carries title + hint to the banner', () => {
    const s = applySseEvent(makeIdleEntry('sess-1'), {
      type: 'error',
      data: {
        code: 'llm_gateway_forbidden',
        message: 'API Error: 403 Forbidden',
        title: 'AI service refused the request (403)',
        hint: 'Connect to the VPN, then retry.',
      },
    });
    expect(s.status).toBe('error');
    expect(s.errorTitle).toBe('AI service refused the request (403)');
    expect(s.errorHint).toBe('Connect to the VPN, then retry.');
  });
});

describe('clearStreamBuffers', () => {
  it('zeroes streaming fields without touching status/session', () => {
    const done = runFullTurn(makeIdleEntry('sess-1'));
    const cleared = clearStreamBuffers(done);
    expect(cleared.currentText).toBe('');
    expect(cleared.currentReasoning).toBe('');
    expect(cleared.currentArtifacts).toEqual([]);
    expect(cleared.currentCharts).toEqual([]);
    expect(cleared.currentToolCalls).toEqual([]);
    expect(cleared.status).toBe('done');
    expect(cleared.sessionId).toBe('sess-1');
  });
});

describe('applySseEvent — Phase 04 cancel/abort path', () => {
  it('turn_started populates turnId without touching status', () => {
    let s = makeIdleEntry('sess-1');
    s = applySseEvent(s, { type: 'loading', data: {} });
    s = applySseEvent(s, { type: 'turn_started', data: { turnId: 'turn-abc' } });
    expect(s.turnId).toBe('turn-abc');
    expect(s.status).toBe('loading');
  });

  it('turn_aborted captures reason + flips status to aborted', () => {
    let s = makeIdleEntry('sess-1');
    s = applySseEvent(s, { type: 'turn_started', data: { turnId: 'turn-abc' } });
    s = applySseEvent(s, { type: 'token', data: { delta: 'partial' } });
    s = applySseEvent(s, {
      type: 'turn_aborted',
      data: { reason: 'user_cancel', message: 'AbortError' },
    });
    expect(s.status).toBe('aborted');
    expect(s.abort).toEqual({ reason: 'user_cancel', message: 'AbortError' });
    // Partial text is preserved so the FE can render the truncated reply.
    expect(s.currentText).toBe('partial');
  });

  it('done arriving after turn_aborted preserves the aborted status', () => {
    let s = makeIdleEntry('sess-1');
    s = applySseEvent(s, { type: 'turn_aborted', data: { reason: 'timeout' } });
    s = applySseEvent(s, { type: 'done', data: {} });
    expect(s.status).toBe('aborted');
  });

  it('clearStreamBuffers wipes abort info alongside other buffers', () => {
    let s = makeIdleEntry('sess-1');
    s = applySseEvent(s, { type: 'turn_aborted', data: { reason: 'server_error' } });
    const cleared = clearStreamBuffers(s);
    expect(cleared.abort).toBeNull();
  });

  it('synthesizes a completed chip for an orphan tool_result (no preceding tool_call)', () => {
    // Reachable on replay when the tool_call event was evicted from the ring
    // before its result. The chip must still render rather than vanish.
    let s = makeIdleEntry('sess-1');
    s = applySseEvent(s, { type: 'tool_result', data: { id: 'orphan-1', ok: true, ms: 9, summary: 'done' } });
    expect(s.currentToolCalls).toHaveLength(1);
    expect(s.currentToolCalls[0]).toMatchObject({ id: 'orphan-1', status: 'ok', ms: 9, summary: 'done' });
  });

  it('still updates the matching tool_call when one exists (no duplicate chip)', () => {
    let s = makeIdleEntry('sess-1');
    s = applySseEvent(s, { type: 'tool_call', data: { id: 'tc-1', name: 'list_metrics', args: {} } });
    s = applySseEvent(s, { type: 'tool_result', data: { id: 'tc-1', ok: false, ms: 5, summary: 'boom' } });
    expect(s.currentToolCalls).toHaveLength(1);
    expect(s.currentToolCalls[0]).toMatchObject({ id: 'tc-1', name: 'list_metrics', status: 'error' });
  });
});
