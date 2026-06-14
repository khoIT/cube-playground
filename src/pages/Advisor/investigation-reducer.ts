/**
 * Pure reducer mapping the agent's runtime-event stream to Drive UI state.
 *
 * The agent narrates an investigation and calls provenanced tools; this reducer
 * turns that stream into: the running narration, a tool-activity timeline, which
 * of the five experiment-anatomy stages have been touched (so the rail lights
 * up), the live cost, and the terminal state. Numbers inside the narration are
 * exploratory; a tool result is the validated source (badged in the UI).
 */

import type { AgentRuntimeEvent, AgentStopReason, AgentErrorCode } from '../../api/advisor';
import type { StageKey } from './advisor-types';

/** Which experiment stage each tool advances — lights up the stage rail. */
const TOOL_STAGE: Record<string, StageKey> = {
  diagnose: 'opportunity',
  cube_query: 'opportunity',
  cube_meta: 'opportunity',
  predicate_compile: 'target',
  map_levers: 'lever',
  recommend: 'lever',
  check_power: 'proof',
  expected_incremental: 'proof',
  list_priors: 'proof',
  scaffold_draft: 'proof',
};

export interface ActivityLine {
  tool: string;
  /** 'running' while the call is in flight; 'ok'/'error' once it returns. */
  state: 'running' | 'ok' | 'error';
  /** True once a tool returned successfully — its numbers are validated. */
  validated: boolean;
}

export interface DriveState {
  status: 'idle' | 'streaming' | 'done' | 'error';
  sessionId: string | null;
  narration: string;
  activity: ActivityLine[];
  stagesTouched: StageKey[];
  costUsd: number | null;
  stopReason: AgentStopReason | null;
  error: { code: AgentErrorCode; message: string } | null;
}

export const INITIAL_DRIVE_STATE: DriveState = {
  status: 'idle',
  sessionId: null,
  narration: '',
  activity: [],
  stagesTouched: [],
  costUsd: null,
  stopReason: null,
  error: null,
};

/** Mark a turn as started (preserves sessionId for multi-turn steering). */
export function startTurn(prev: DriveState): DriveState {
  return { ...prev, status: 'streaming', error: null, stopReason: null };
}

function withStage(stages: StageKey[], tool: string): StageKey[] {
  const stage = TOOL_STAGE[tool];
  if (!stage || stages.includes(stage)) return stages;
  return [...stages, stage];
}

/** Fold one runtime event into the Drive state. */
export function reduceDrive(state: DriveState, ev: AgentRuntimeEvent): DriveState {
  switch (ev.type) {
    case 'session':
      return { ...state, sessionId: ev.sessionId };
    case 'assistant_delta':
      return { ...state, narration: state.narration + ev.text };
    case 'tool_call':
      return {
        ...state,
        activity: [...state.activity, { tool: ev.tool, state: 'running', validated: false }],
        stagesTouched: withStage(state.stagesTouched, ev.tool),
      };
    case 'tool_result': {
      // Settle the most recent running line for this tool.
      const idx = [...state.activity].reverse().findIndex((a) => a.tool === ev.tool && a.state === 'running');
      const activity = state.activity.slice();
      if (idx !== -1) {
        const realIdx = activity.length - 1 - idx;
        activity[realIdx] = { tool: ev.tool, state: ev.ok ? 'ok' : 'error', validated: ev.ok };
      } else {
        activity.push({ tool: ev.tool, state: ev.ok ? 'ok' : 'error', validated: ev.ok });
      }
      return { ...state, activity, stagesTouched: withStage(state.stagesTouched, ev.tool) };
    }
    case 'denied':
      return {
        ...state,
        activity: [...state.activity, { tool: ev.tool, state: 'error', validated: false }],
      };
    case 'cost':
      return { ...state, costUsd: ev.usd };
    case 'done':
      return {
        ...state,
        status: state.status === 'error' ? 'error' : 'done',
        stopReason: ev.stopReason,
        costUsd: ev.usd ?? state.costUsd,
      };
    case 'error':
      return { ...state, status: 'error', error: { code: ev.code, message: ev.message } };
    default:
      return state;
  }
}
