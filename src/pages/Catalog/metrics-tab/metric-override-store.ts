/**
 * Per-session "Run anyway" override store for broken business metrics.
 *
 * Override is intentionally NOT persisted — a reload re-arms the guard so
 * broken metrics keep being annoying. The mental model is "I know it's
 * broken, let me try this once," not a permanent ack.
 */

import { create } from 'zustand';

interface MetricOverrideState {
  /** Set of metric ids the user has explicitly allowed to run this session. */
  allowed: Set<string>;
  allow: (metricId: string) => void;
  reset: () => void;
  isAllowed: (metricId: string) => boolean;
}

export const useMetricOverrideStore = create<MetricOverrideState>((set, get) => ({
  allowed: new Set<string>(),
  allow: (metricId) =>
    set((state) => {
      if (state.allowed.has(metricId)) return state;
      const next = new Set(state.allowed);
      next.add(metricId);
      return { allowed: next };
    }),
  reset: () => set({ allowed: new Set<string>() }),
  isAllowed: (metricId) => get().allowed.has(metricId),
}));
