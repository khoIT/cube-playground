/**
 * Fetch hook for the skill leaderboard.
 * Mirrors useDebugSessions pattern: owner-scoped, re-fetches on param change.
 */

import { useState, useEffect } from 'react';
import { getOwnerId } from '../../api/chat-owner-id';

export interface SkillRow {
  skill: string;
  count: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  avgCostUsd: number | null;
  totalCostUsd: number;
  successRate: number | null;
  legacyCount: number;
}

interface LeaderboardState {
  skills: SkillRow[];
  computedAt: string | null;
  isLoading: boolean;
  error: string | null;
}

export function useSkillLeaderboard(opts: { gameId?: string; days: number }): LeaderboardState {
  const [state, setState] = useState<LeaderboardState>({
    skills: [],
    computedAt: null,
    isLoading: false,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, isLoading: true, error: null }));

    const params = new URLSearchParams({ days: String(opts.days) });
    if (opts.gameId) params.set('game', opts.gameId);

    fetch(`/api/chat/debug/leaderboard/skills?${params.toString()}`, {
      headers: { 'X-Owner-Id': getOwnerId() },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<{ skills: SkillRow[]; computedAt: string }>;
      })
      .then(({ skills, computedAt }) =>
        setState({ skills, computedAt, isLoading: false, error: null }),
      )
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setState({ skills: [], computedAt: null, isLoading: false, error: err.message });
      });

    return () => controller.abort();
  }, [opts.gameId, opts.days]);

  return state;
}
