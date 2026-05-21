/**
 * MM-01 CDP-metrics client. Behind feature flag `VITE_CDP_ACTIVATION_ENABLED`:
 *   - true  → POST to real endpoint (still TODO server-side)
 *   - false → mock variant returns a synthetic success after 500ms
 *
 * Phase 7 ships the surface; Phase 7+ wires the real backend.
 */

import { apiFetch } from './api-client';

export interface CreateMetricPayload {
  metric_name: string;
  expression: string;
  filter: string;
  source: string;
  dimensions: string[];
  env: 'dev' | 'stag' | 'prod';
  game_id: string;
  materialize?: { cron: string };
}

export interface CreateMetricResult {
  metric_id: string;
  status: 'active' | 'pending' | 'failed';
  message?: string;
}

function isEnabled(): boolean {
  try {
    return Boolean((import.meta as { env?: Record<string, string> }).env?.VITE_CDP_ACTIVATION_ENABLED);
  } catch {
    return false;
  }
}

async function mockCreate(payload: CreateMetricPayload): Promise<CreateMetricResult> {
  await new Promise((r) => setTimeout(r, 500));
  return {
    metric_id: `mock_${payload.metric_name}`,
    status: 'active',
    message: 'CDP wiring is in mock mode — submission simulated.',
  };
}

export const cdpMetricsClient = {
  isMockMode(): boolean {
    return !isEnabled();
  },

  async createMetric(payload: CreateMetricPayload): Promise<CreateMetricResult> {
    if (!isEnabled()) {
      return mockCreate(payload);
    }
    return apiFetch<CreateMetricResult>('/api/cdp/v1/metrics', {
      method: 'POST',
      body: payload,
    });
  },
};
