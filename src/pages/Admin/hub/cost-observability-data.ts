/**
 * Data layer for the Cost section of the admin observability tab.
 *
 *   useCostSummary(range) → GET /api/admin/cost/summary (org-wide LLM spend
 *   broken down by user / game / workspace + top-N sessions by cost)
 *
 * Range keys map to a `from` cutoff; 'all' omits `from` (server treats that
 * as all-time — "total cost of the whole app"). `breakdown: null` means the
 * chat-service was unreachable — render "—", never an error page.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../api/api-client';

// ── Shapes (mirror server: routes/admin-cost.ts) ──────────────────────────────

export interface CostBucket {
  cost_usd: number;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  sessions: number;
}

export interface UserCostRow extends CostBucket {
  owner_id: string;
  owner_label: string | null;
  email: string | null;
}

export interface GameCostRow extends CostBucket {
  game_id: string;
}

export interface WorkspaceCostRow extends CostBucket {
  workspace: string;
}

export interface SessionCostRow {
  session_id: string;
  title: string | null;
  owner_id: string;
  owner_label: string | null;
  email: string | null;
  game_id: string;
  workspace: string;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  last_turn_at: number | null;
}

export interface CostSummary {
  generatedAt: number;
  breakdown: {
    total: CostBucket;
    byUser: UserCostRow[];
    byGame: GameCostRow[];
    byWorkspace: WorkspaceCostRow[];
    sessions: SessionCostRow[];
    sessionTotal: number;
  } | null;
}

// ── Range keys ────────────────────────────────────────────────────────────────

export type CostRangeKey = '7d' | '30d' | '90d' | 'all';

export const COST_RANGE_LABEL: Record<CostRangeKey, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  all: 'All time',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS: Record<Exclude<CostRangeKey, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

/** Query string for a range key ('' for all-time). Exported for unit testing. */
export function costRangeQueryString(range: CostRangeKey, now = Date.now()): string {
  if (range === 'all') return '';
  const from = new Date(now - RANGE_DAYS[range] * DAY_MS).toISOString();
  return `?${new URLSearchParams({ from }).toString()}`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCostSummary(range: CostRangeKey) {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<CostSummary>(`/api/admin/cost/summary${costRangeQueryString(range)}`)
      .then(setSummary)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { refetch(); }, [refetch]);

  return { summary, loading, error, refetch };
}
