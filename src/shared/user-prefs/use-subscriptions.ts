/**
 * Subscription preferences. v1: cadence × channel × metricId records. No
 * delivery wiring — purely a registry the DigestPage reads to render mock
 * Slack / email previews.
 */

import { useCallback, useEffect, useState } from 'react';

import { createUserPrefsStore } from './user-prefs-store';

export type Cadence = 'daily' | 'weekly' | 'on-anomaly';
export type Channel = 'slack' | 'email';

export interface MetricSubscription {
  metricId: string;
  cadence: Cadence;
  channel: Channel;
  createdAt: string;
}

const store = createUserPrefsStore<MetricSubscription[]>('subscriptions', []);

export function useSubscriptions() {
  const [value, setValue] = useState<MetricSubscription[]>(() => store.read());

  useEffect(() => store.subscribe(() => setValue(store.read())), []);

  const upsert = useCallback((sub: MetricSubscription) => {
    const next = store
      .read()
      .filter(
        (s) =>
          !(
            s.metricId === sub.metricId &&
            s.cadence === sub.cadence &&
            s.channel === sub.channel
          ),
      );
    next.push(sub);
    store.write(next);
  }, []);

  const remove = useCallback((metricId: string) => {
    const next = store.read().filter((s) => s.metricId !== metricId);
    store.write(next);
  }, []);

  const forMetric = useCallback(
    (metricId: string) => value.filter((s) => s.metricId === metricId),
    [value],
  );

  return { subscriptions: value, upsert, remove, forMetric };
}

export function __resetSubscriptionsForTest(): void {
  store.clear();
}
