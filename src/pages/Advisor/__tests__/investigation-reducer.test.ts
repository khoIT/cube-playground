/**
 * The Drive reducer maps the agent runtime-event stream to UI state: narration
 * accrues, tool calls light the stage rail and settle to validated, and terminal
 * events set status/cost.
 */
import { describe, it, expect } from 'vitest';
import {
  reduceDrive,
  startTurn,
  INITIAL_DRIVE_STATE,
  type DriveState,
} from '../investigation-reducer';
import type { AgentRuntimeEvent } from '../../../api/advisor';

function fold(events: AgentRuntimeEvent[], from: DriveState = startTurn(INITIAL_DRIVE_STATE)): DriveState {
  return events.reduce(reduceDrive, from);
}

describe('reduceDrive', () => {
  it('captures the session id for multi-turn steering', () => {
    const s = reduceDrive(INITIAL_DRIVE_STATE, { type: 'session', sessionId: 'sess-1' });
    expect(s.sessionId).toBe('sess-1');
  });

  it('accumulates assistant_delta into narration', () => {
    const s = fold([
      { type: 'assistant_delta', text: 'Looking ' },
      { type: 'assistant_delta', text: 'at payers…' },
    ]);
    expect(s.narration).toBe('Looking at payers…');
  });

  it('lights the matching stage and settles a tool call to validated', () => {
    const s = fold([
      { type: 'tool_call', tool: 'diagnose' },
      { type: 'tool_result', tool: 'diagnose', ok: true },
    ]);
    expect(s.stagesTouched).toContain('opportunity'); // diagnose → opportunity
    expect(s.activity).toHaveLength(1);
    expect(s.activity[0]).toMatchObject({ tool: 'diagnose', state: 'ok', validated: true });
  });

  it('maps recommend/check_power to lever/proof stages', () => {
    const s = fold([
      { type: 'tool_call', tool: 'recommend' },
      { type: 'tool_call', tool: 'check_power' },
    ]);
    expect(s.stagesTouched).toEqual(expect.arrayContaining(['lever', 'proof']));
  });

  it('settles done with stop reason + cost', () => {
    const s = fold([{ type: 'cost', usd: 0.04 }, { type: 'done', usd: 0.05, stopReason: 'end_turn' }]);
    expect(s.status).toBe('done');
    expect(s.stopReason).toBe('end_turn');
    expect(s.costUsd).toBe(0.05);
  });

  it('an error event flips status to error and keeps it on done', () => {
    const s = fold([
      { type: 'error', code: 'oauth_unavailable', message: 'no token' },
      { type: 'done', usd: null, stopReason: 'error' },
    ]);
    expect(s.status).toBe('error');
    expect(s.error).toMatchObject({ code: 'oauth_unavailable' });
  });

  it('marks a denied tool as failed, not validated', () => {
    const s = fold([{ type: 'denied', tool: 'mcp__other__x', reason: 'not allowed' }]);
    expect(s.activity[0]).toMatchObject({ state: 'error', validated: false });
  });
});
