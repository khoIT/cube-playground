/**
 * useDigestSubscriptions — fetches and mutates digest subscriptions for a game.
 * Subscriptions are owner-scoped; server gates on authenticated identity.
 */

import { useState, useEffect, useCallback } from 'react';

export type DigestCadence = 'daily' | 'weekly';

export interface DigestSubscription {
  id: number;
  owner: string;
  game: string;
  metrics: string[];
  cadence: DigestCadence;
  channel: string;
  next_run_at: number | null;
  last_run_date: string | null;
  created_at: number;
}

export interface CreateSubscriptionInput {
  game: string;
  metrics: string[];
  cadence: DigestCadence;
}

export interface UseDigestSubscriptionsResult {
  subscriptions: DigestSubscription[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  createSubscription: (input: CreateSubscriptionInput) => Promise<void>;
  deleteSubscription: (id: number) => Promise<void>;
}

export function useDigestSubscriptions(gameId: string): UseDigestSubscriptionsResult {
  const [subscriptions, setSubscriptions] = useState<DigestSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/digest-subscriptions?game=${encodeURIComponent(gameId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ subscriptions: DigestSubscription[] }>;
      })
      .then((data) => {
        if (!cancelled) {
          setSubscriptions(data.subscriptions ?? []);
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

  const createSubscription = useCallback(async (input: CreateSubscriptionInput) => {
    const res = await fetch('/api/digest-subscriptions', {
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

  const deleteSubscription = useCallback(async (id: number) => {
    const prev = subscriptions;
    setSubscriptions((ss) => ss.filter((s) => s.id !== id));
    const res = await fetch(`/api/digest-subscriptions/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      setSubscriptions(prev);
      throw new Error(`HTTP ${res.status}`);
    }
  }, [subscriptions]);

  return { subscriptions, loading, error, refetch, createSubscription, deleteSubscription };
}
