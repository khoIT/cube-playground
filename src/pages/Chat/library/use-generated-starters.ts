/**
 * useGeneratedStarters — load the per-(workspace, game) pre-generated
 * starter-question set from the gateway, falling back to the static library
 * when the backend has nothing usable (no set yet, sparse schema, fetch
 * error). Re-fetches when the active game or workspace changes so switching
 * tenants swaps the suggestion pool.
 *
 * The returned pool feeds the existing persona filter + histogram ranking
 * unchanged — only the SOURCE of the questions varies.
 */
import { useEffect, useState } from 'react';
import { chatHeaders } from '../../../api/chat-auth-headers';
import {
  getActiveGameId,
  GAME_CHANGE_EVENT,
} from '../../../components/Header/active-game-storage';
import { WORKSPACE_CHANGE_EVENT } from '../../../components/workspace-context';
import { STARTER_QUESTIONS, type StarterQuestion } from './starter-questions';

export type StarterSource = 'static-fallback' | 'template' | 'llm';

export interface UseGeneratedStartersResult {
  starters: ReadonlyArray<StarterQuestion>;
  source: StarterSource;
  loading: boolean;
}

interface StarterApiResponse {
  questions?: StarterQuestion[];
  source?: string;
}

export function useGeneratedStarters(): UseGeneratedStartersResult {
  // Tick bumps on game/workspace change so the fetch effect re-runs even
  // though the getters live outside React state.
  const [tick, setTick] = useState(0);
  const [result, setResult] = useState<UseGeneratedStartersResult>({
    starters: STARTER_QUESTIONS,
    source: 'static-fallback',
    loading: true,
  });

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(GAME_CHANGE_EVENT, bump);
    window.addEventListener(WORKSPACE_CHANGE_EVENT, bump);
    return () => {
      window.removeEventListener(GAME_CHANGE_EVENT, bump);
      window.removeEventListener(WORKSPACE_CHANGE_EVENT, bump);
    };
  }, []);

  useEffect(() => {
    const game = getActiveGameId();
    // Workspace travels via chatHeaders (X-Cube-Workspace); the effect
    // re-runs on workspace change through the `tick` listener above.
    if (!game) {
      setResult({ starters: STARTER_QUESTIONS, source: 'static-fallback', loading: false });
      return;
    }

    let cancelled = false;
    setResult((prev) => ({ ...prev, loading: true }));
    fetch(`/api/chat/starter-questions?game=${encodeURIComponent(game)}`, {
      headers: chatHeaders({ Accept: 'application/json' }),
      cache: 'no-store',
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error(`starter-questions ${res.status}`);
        const data = (await res.json()) as StarterApiResponse;
        const questions = Array.isArray(data.questions) ? data.questions : [];
        if (questions.length === 0 || data.source === 'static-fallback') {
          setResult({ starters: STARTER_QUESTIONS, source: 'static-fallback', loading: false });
        } else {
          setResult({
            starters: questions,
            source: data.source === 'llm' ? 'llm' : 'template',
            loading: false,
          });
        }
      })
      .catch(() => {
        // Soft fail — static library is always a valid set.
        if (!cancelled) {
          setResult({ starters: STARTER_QUESTIONS, source: 'static-fallback', loading: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return result;
}
