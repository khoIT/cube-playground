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
import type { QueryArtifact } from '../../../../api/chat-sse-client';

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

function streamToDone(state: StreamState): StreamState {
  let s = chatStreamReducer(state, { type: 'START', sessionId: state.sessionId });
  s = chatStreamReducer(s, { type: 'TOOL_CALL', id: 'tc-1', name: 'list_business_metrics', args: {} });
  s = chatStreamReducer(s, { type: 'TOOL_RESULT', id: 'tc-1', ok: true, ms: 12, summary: 'ok' });
  s = chatStreamReducer(s, { type: 'TOKEN', delta: 'Hello ' });
  s = chatStreamReducer(s, { type: 'TOKEN', delta: 'world' });
  s = chatStreamReducer(s, { type: 'THINKING', delta: 'reasoning…' });
  s = chatStreamReducer(s, { type: 'ARTIFACT', artifact: makeArtifact('a-1') });
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
  });
});
