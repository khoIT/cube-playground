/**
 * advisor-failure-hints — pure mapping from a run failure to a next-step hint.
 * The headline case is the cold-Trino timeout (timeout + failed cube_query).
 */

import { describe, it, expect } from 'vitest';
import { failureHint, collectToolOutcomes } from '../advisor-failure-hints';

describe('failureHint', () => {
  it('returns null for a clean end_turn with no denied tools', () => {
    expect(failureHint({ stopReason: 'end_turn' })).toBeNull();
  });

  it('maps timeout + failed cube_query to the cold-Trino hint', () => {
    const hint = failureHint({ stopReason: 'timeout', failedTools: ['cube_query'] });
    expect(hint).not.toBeNull();
    expect(hint!.severity).toBe('error');
    expect(hint!.title.toLowerCase()).toContain('cold trino');
    expect(hint!.hint.toLowerCase()).toContain('warm');
  });

  it('maps a generic timeout (no cube_query) to a plain timeout hint', () => {
    const hint = failureHint({ stopReason: 'timeout', failedTools: ['diagnose'] });
    expect(hint!.title.toLowerCase()).toContain('timed out');
    expect(hint!.title.toLowerCase()).not.toContain('cold');
  });

  it('maps budget and max_turns to error hints', () => {
    expect(failureHint({ stopReason: 'budget' })!.title.toLowerCase()).toContain('cost');
    expect(failureHint({ stopReason: 'max_turns' })!.title.toLowerCase()).toContain('turns');
  });

  it('treats client-disconnect abort as benign info', () => {
    const hint = failureHint({ stopReason: 'aborted', abortCause: 'client_disconnect' });
    expect(hint!.severity).toBe('info');
    expect(hint!.hint.toLowerCase()).toContain('resumable');
  });

  it('flags denied tools as benign even on a clean stop', () => {
    const hint = failureHint({ stopReason: 'end_turn', deniedTools: ['Bash'] });
    expect(hint!.severity).toBe('info');
    expect(hint!.hint).toContain('Bash');
  });

  it('maps error stop to an SDK-error hint', () => {
    expect(failureHint({ stopReason: 'error' })!.title.toLowerCase()).toContain('error');
  });
});

describe('collectToolOutcomes', () => {
  it('collects distinct failed and denied tool names across turns', () => {
    const turns = [
      { toolCalls: [{ tool: 'cube_query', state: 'failed' }, { tool: 'diagnose', state: 'ok' }] },
      { toolCalls: [{ tool: 'cube_query', state: 'failed' }, { tool: 'Bash', state: 'denied' }] },
    ];
    const out = collectToolOutcomes(turns);
    expect(out.failedTools).toEqual(['cube_query']);
    expect(out.deniedTools).toEqual(['Bash']);
  });
});
