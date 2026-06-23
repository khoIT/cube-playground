/**
 * useAlertRules — fetches and mutates alert rules for a game.
 *
 * Rules are owner-scoped on the server; the API rejects unauthenticated callers.
 * Optimistic delete so the list updates immediately on user action.
 */

import { useState, useEffect, useCallback } from 'react';

export type Comparator = '<' | '>' | '<=' | '>=' | 'pct_drop' | 'pct_rise';

export interface AlertRule {
  id: number;
  owner: string;
  game: string;
  metric: string;
  comparator: Comparator;
  threshold: number;
  window: string | null;
  channel: string;
  enabled: number;
  created_at: number;
}

export interface CreateRuleInput {
  game: string;
  metric: string;
  comparator: Comparator;
  threshold: number;
  window?: string;
}

export interface UseAlertRulesResult {
  rules: AlertRule[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  createRule: (input: CreateRuleInput) => Promise<void>;
  toggleRule: (id: number, enabled: boolean) => Promise<void>;
  deleteRule: (id: number) => Promise<void>;
}

export function useAlertRules(gameId: string): UseAlertRulesResult {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/alert-rules?game=${encodeURIComponent(gameId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ rules: AlertRule[] }>;
      })
      .then((data) => {
        if (!cancelled) {
          setRules(data.rules ?? []);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [gameId, tick]);

  const createRule = useCallback(async (input: CreateRuleInput) => {
    const res = await fetch('/api/alert-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    refetch();
  }, [refetch]);

  const toggleRule = useCallback(async (id: number, enabled: boolean) => {
    // Optimistic update
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, enabled: enabled ? 1 : 0 } : r));
    const res = await fetch(`/api/alert-rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enabled ? 1 : 0 }),
    });
    if (!res.ok) {
      // Rollback
      setRules((prev) => prev.map((r) => r.id === id ? { ...r, enabled: enabled ? 0 : 1 } : r));
      throw new Error(`HTTP ${res.status}`);
    }
  }, []);

  const deleteRule = useCallback(async (id: number) => {
    const prev = rules;
    // Optimistic removal
    setRules((rs) => rs.filter((r) => r.id !== id));
    const res = await fetch(`/api/alert-rules/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      setRules(prev);
      throw new Error(`HTTP ${res.status}`);
    }
  }, [rules]);

  return { rules, loading, error, refetch, createRule, toggleRule, deleteRule };
}
