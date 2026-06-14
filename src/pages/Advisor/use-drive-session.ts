/**
 * Hook that drives one live agent investigation: opens an SSE turn, folds the
 * runtime events into DriveState via the reducer, and keeps the sessionId so a
 * follow-up "steer" turn continues the SAME investigation. Aborts the in-flight
 * stream on unmount (the server keeps the session resumable).
 */

import { useReducer, useRef, useCallback, useEffect } from 'react';
import { streamAgentTurn, type AgentMode, type AgentRuntimeEvent, type AdvisorScope, type AdvisorGoal } from '../../api/advisor';
import {
  reduceDrive,
  startTurn,
  INITIAL_DRIVE_STATE,
  type DriveState,
} from './investigation-reducer';

type Action = { kind: 'start' } | { kind: 'event'; ev: AgentRuntimeEvent } | { kind: 'reset' };

function reducer(state: DriveState, action: Action): DriveState {
  if (action.kind === 'start') return startTurn(state);
  if (action.kind === 'reset') return INITIAL_DRIVE_STATE;
  return reduceDrive(state, action.ev);
}

export interface DriveSession {
  state: DriveState;
  /** Start (or steer, when a sessionId exists) the investigation with a message. */
  run: (message: string, mode?: AgentMode) => void;
  abort: () => void;
  reset: () => void;
}

export function useDriveSession(scope: AdvisorScope, goal: AdvisorGoal): DriveSession {
  const [state, dispatch] = useReducer(reducer, INITIAL_DRIVE_STATE);
  const abortRef = useRef<(() => void) | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // Keep the latest sessionId for multi-turn steering without re-binding run().
  useEffect(() => {
    sessionIdRef.current = state.sessionId;
  }, [state.sessionId]);

  const run = useCallback(
    (message: string, mode?: AgentMode) => {
      abortRef.current?.(); // cancel any prior in-flight turn
      dispatch({ kind: 'start' });
      const stream = streamAgentTurn(
        {
          message,
          scope,
          goal,
          sessionId: sessionIdRef.current ?? undefined,
          mode: mode ?? (sessionIdRef.current ? 'steer' : 'drive'),
        },
        (ev) => dispatch({ kind: 'event', ev }),
      );
      abortRef.current = stream.abort;
    },
    [scope, goal],
  );

  const abort = useCallback(() => abortRef.current?.(), []);
  const reset = useCallback(() => {
    abortRef.current?.();
    sessionIdRef.current = null;
    dispatch({ kind: 'reset' });
  }, []);

  useEffect(() => () => abortRef.current?.(), []); // abort on unmount

  return { state, run, abort, reset };
}
