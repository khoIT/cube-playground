/**
 * Regression test for the chat-turn duplication bug.
 *
 * Before the fix, the `DONE` action preserved currentText/currentReasoning/
 * currentArtifacts/currentToolCalls. Consumers then both committed those
 * buffers into a persistent message list AND re-rendered a "live preview"
 * clone — every assistant turn appeared twice once streaming finished.
 *
 * The fix adds a `CLEAR_STREAM_BUFFERS` action that zeroes the streaming
 * buffers without touching status / sessionId / lastCompactWarning. Consumers
 * call it immediately after committing.
 */
import { describe, it, expect } from 'vitest';
import {
  chatStreamReducer,
  makeInitialStreamState,
  type StreamState,
} from '../use-chat-stream-reducer';
import type { QueryArtifact, ChartArtifact } from '../../../../api/chat-sse-client';

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

function streamToDone(state: StreamState): StreamState {
  let s = chatStreamReducer(state, { type: 'START', sessionId: state.sessionId });
  s = chatStreamReducer(s, { type: 'TOOL_CALL', id: 'tc-1', name: 'list_business_metrics', args: {} });
  s = chatStreamReducer(s, { type: 'TOOL_RESULT', id: 'tc-1', ok: true, ms: 12, summary: 'ok' });
  s = chatStreamReducer(s, { type: 'TOKEN', delta: 'Hello ' });
  s = chatStreamReducer(s, { type: 'TOKEN', delta: 'world' });
  s = chatStreamReducer(s, { type: 'THINKING', delta: 'reasoning…' });
  s = chatStreamReducer(s, { type: 'ARTIFACT', artifact: makeArtifact('a-1') });
  s = chatStreamReducer(s, { type: 'CHART', artifact: makeChart('c-1') });
  s = chatStreamReducer(s, { type: 'DONE' });
  return s;
}

describe('chatStreamReducer — duplication regression', () => {
  it('DONE preserves stream buffers so consumers can commit them', () => {
    const initial = makeInitialStreamState('sess-1');
    const done = streamToDone(initial);

    expect(done.status).toBe('done');
    expect(done.currentText).toBe('Hello world');
    expect(done.currentReasoning).toBe('reasoning…');
    expect(done.currentToolCalls).toHaveLength(1);
    expect(done.currentArtifacts).toHaveLength(1);
    expect(done.currentCharts).toHaveLength(1);
  });

  it('CLEAR_STREAM_BUFFERS zeroes streaming fields without touching status/session', () => {
    const initial = makeInitialStreamState('sess-1');
    const done = streamToDone(initial);
    const cleared = chatStreamReducer(done, { type: 'CLEAR_STREAM_BUFFERS' });

    // Streaming buffers wiped — consumer's live-preview branch will be false
    // on subsequent renders, eliminating the duplicate.
    expect(cleared.currentText).toBe('');
    expect(cleared.currentReasoning).toBe('');
    expect(cleared.currentToolCalls).toEqual([]);
    expect(cleared.currentArtifacts).toEqual([]);
    expect(cleared.currentCharts).toEqual([]);

    // Identity-bearing fields preserved.
    expect(cleared.status).toBe('done');
    expect(cleared.sessionId).toBe('sess-1');
  });

  it('CLEAR_STREAM_BUFFERS preserves lastCompactWarning and retryAfterMs', () => {
    let s = makeInitialStreamState('sess-1');
    s = chatStreamReducer(s, {
      type: 'COMPACT_WARNING',
      from: 'sess-1',
      to: 'sess-2',
      summary: 'compacted',
    });
    s = chatStreamReducer(s, { type: 'RATE_LIMITED', retryAfterMs: 5000 });
    s = chatStreamReducer(s, { type: 'TOKEN', delta: 'partial' });
    s = chatStreamReducer(s, { type: 'CLEAR_STREAM_BUFFERS' });

    expect(s.currentText).toBe('');
    expect(s.lastCompactWarning).toEqual({
      from: 'sess-1',
      to: 'sess-2',
      summary: 'compacted',
    });
    expect(s.retryAfterMs).toBe(5000);
    expect(s.sessionId).toBe('sess-2');
  });

  it('a fresh START after CLEAR_STREAM_BUFFERS still produces a clean turn', () => {
    let s = makeInitialStreamState('sess-1');
    s = streamToDone(s);
    s = chatStreamReducer(s, { type: 'CLEAR_STREAM_BUFFERS' });
    s = chatStreamReducer(s, { type: 'START', sessionId: s.sessionId });

    expect(s.status).toBe('loading');
    expect(s.currentText).toBe('');
    expect(s.currentReasoning).toBe('');
    expect(s.currentToolCalls).toEqual([]);
    expect(s.currentArtifacts).toEqual([]);
    expect(s.currentCharts).toEqual([]);
  });

  it('CHART action appends to currentCharts', () => {
    let s = makeInitialStreamState('sess-1');
    s = chatStreamReducer(s, { type: 'CHART', artifact: makeChart('c-1') });
    s = chatStreamReducer(s, { type: 'CHART', artifact: makeChart('c-2') });
    expect(s.currentCharts).toHaveLength(2);
    expect(s.currentCharts.map((c) => c.id)).toEqual(['c-1', 'c-2']);
  });
});

describe('chatStreamReducer — New chat (EXTERNAL_RESET) regression', () => {
  it('RESET preserves sessionId (cancel mid-turn case)', () => {
    let s = makeInitialStreamState('sess-x');
    s = chatStreamReducer(s, { type: 'TOKEN', delta: 'partial' });
    const reset = chatStreamReducer(s, { type: 'RESET' });
    expect(reset.sessionId).toBe('sess-x');
    expect(reset.currentText).toBe('');
  });

  it('EXTERNAL_RESET clears sessionId so the next turn opens a new session', () => {
    let s = makeInitialStreamState('sess-x');
    s = chatStreamReducer(s, { type: 'TOKEN', delta: 'partial' });
    const cleared = chatStreamReducer(s, { type: 'EXTERNAL_RESET', sessionId: null });
    expect(cleared.sessionId).toBeNull();
    expect(cleared.status).toBe('idle');
    expect(cleared.currentText).toBe('');
  });

  it('EXTERNAL_RESET to a different session id swaps in the new id', () => {
    let s = makeInitialStreamState('sess-x');
    s = chatStreamReducer(s, { type: 'TOKEN', delta: 'partial' });
    const swapped = chatStreamReducer(s, { type: 'EXTERNAL_RESET', sessionId: 'sess-y' });
    expect(swapped.sessionId).toBe('sess-y');
    expect(swapped.currentText).toBe('');
  });
});
