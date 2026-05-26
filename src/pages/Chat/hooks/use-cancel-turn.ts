/**
 * Phase 04 — exposes a single `cancel()` that POSTs to the server's
 * `/api/agent/turn/:turnId/cancel` endpoint. The FE-side fetch is also
 * aborted (via the existing store cancel) so the SSE socket closes cleanly
 * regardless of whether the server-side abort lands first.
 *
 * Behaviour:
 *   - When no `turnId` is yet known (server hasn't emitted `turn_started`),
 *     only the FE cancel runs. The server will surface the in-flight turn's
 *     orphaned state via the normal turn cleanup path.
 *   - When `turnId` is known, both the server-side abort and the FE-side
 *     abort fire in parallel. The server emits `turn_aborted` followed by
 *     `done`, which the store reducer routes into the `aborted` status.
 */

import { useCallback, useState } from 'react';
import { cancelTurn, type CancelTurnResult } from '../../../api/chat-cancel-turn';

interface UseCancelTurnOptions {
  /** Active turnId; null until the server emits `turn_started`. */
  turnId: string | null;
  /** FE-side fetch cancel handle from the chat-stream store. */
  cancelLocal: () => void;
}

export interface UseCancelTurn {
  cancel: () => Promise<CancelTurnResult | null>;
  busy: boolean;
  lastResult: CancelTurnResult | null;
}

export function useCancelTurn({ turnId, cancelLocal }: UseCancelTurnOptions): UseCancelTurn {
  const [busy, setBusy] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<CancelTurnResult | null>(null);

  const cancel = useCallback(async (): Promise<CancelTurnResult | null> => {
    if (busy) return lastResult;
    setBusy(true);
    try {
      // Always cancel the local SSE socket so the UI stops spinning even when
      // the server hasn't surfaced the turnId yet (very early cancel, before
      // `turn_started`).
      cancelLocal();
      if (!turnId) return null;
      const result = await cancelTurn(turnId);
      setLastResult(result);
      return result;
    } finally {
      setBusy(false);
    }
  }, [turnId, cancelLocal, busy, lastResult]);

  return { cancel, busy, lastResult };
}
