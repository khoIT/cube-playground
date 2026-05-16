/**
 * CDP API client (verify path only, v1).
 * Discriminated union — callers handle each branch explicitly. No throws.
 */

export type CdpMetricFullRecord = {
  game_id: string;
  metric_name: string;
  metric_codename: string;
  source: string;
  expression: string;
  dimensions: string[];
  filter: string;
  materialize: boolean;
  schedule: string;
  created_at: string;
  updated_at: string;
};

export type GetMetricResult =
  | { ok: true; data: CdpMetricFullRecord }
  | { ok: false; status: 404; reason: 'METRIC_NOT_FOUND' | 'GAME_NOT_FOUND' }
  | { ok: false; status: number; reason: string };

export async function getMetric(gameId: string, metricName: string): Promise<GetMetricResult> {
  const url = `/cdp/v1/metrics/${encodeURIComponent(gameId)}/${encodeURIComponent(metricName)}`;
  let resp: Response;
  try {
    resp = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (e) {
    return { ok: false, status: 0, reason: e instanceof Error ? e.message : 'Network error' };
  }

  let body: { status?: string; data?: CdpMetricFullRecord; error?: { code?: string; message?: string } } = {};
  try {
    body = (await resp.json()) as typeof body;
  } catch {
    /* ignore parse error */
  }

  if (resp.ok && body.status === 'SUCCESS' && body.data) {
    return { ok: true, data: body.data };
  }

  if (resp.status === 404) {
    const code = body.error?.code;
    if (code === 'METRIC_NOT_FOUND' || code === 'GAME_NOT_FOUND') {
      return { ok: false, status: 404, reason: code };
    }
    return { ok: false, status: 404, reason: 'METRIC_NOT_FOUND' };
  }

  return {
    ok: false,
    status: resp.status,
    reason: body.error?.message ?? body.error?.code ?? `HTTP ${resp.status}`,
  };
}
