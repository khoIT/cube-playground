/**
 * Hook for the Settings → Chat "Remembered defaults" section. Loads the
 * list from chat-service, exposes per-row and clear-all delete actions,
 * and re-fetches after a mutation so the UI stays in sync.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  listRememberedDefaults,
  deleteRememberedDefault,
  deleteAllRememberedDefaults,
  type RememberedDefaultRow,
} from '../../api/chat-user-prefs-client';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { useSecurityContext } from '../../hooks/security-context';

export interface UseChatRememberedDefaults {
  rows: RememberedDefaultRow[];
  loading: boolean;
  gameId: string;
  refresh: () => Promise<void>;
  removeOne: (slot: string) => Promise<void>;
  removeAll: () => Promise<void>;
}

export function useChatRememberedDefaults(): UseChatRememberedDefaults {
  const gameId = useActiveGameId();
  const { token: cubeToken } = useSecurityContext();
  const [rows, setRows] = useState<RememberedDefaultRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    if (!gameId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const items = await listRememberedDefaults(gameId, cubeToken ?? null);
    setRows(items);
    setLoading(false);
  }, [gameId, cubeToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const removeOne = useCallback(async (slot: string) => {
    if (!gameId) return;
    const ok = await deleteRememberedDefault(gameId, slot);
    if (ok) await refresh();
  }, [gameId, refresh]);

  const removeAll = useCallback(async () => {
    if (!gameId) return;
    const ok = await deleteAllRememberedDefaults(gameId);
    if (ok) await refresh();
  }, [gameId, refresh]);

  return { rows, loading, gameId, refresh, removeOne, removeAll };
}
