/**
 * Tool: get_metric_benchmark
 *
 * Fetches the dual benchmark for a single metric key from the knowledge
 * library (GET /api/knowledge/benchmark): the hand-authored EXTERNAL industry
 * norm (only when fully sourced) and the INTERNAL portfolio percentile band
 * (from the nightly snapshot). Either side may be absent.
 *
 * Use once a diagnosis has named the driving metric, to put it in context:
 * state its value against the internal band and external norm. When `available`
 * is false for both sides, say so explicitly — never invent a number.
 *
 * Known metric keys carried by the library include: arppu_vnd,
 * payer_conversion_rate, whale_revenue_share, vip_conversion_rate,
 * clan_member_share, rank_drop_rate, gacha_participation_rate,
 * server_peak_ccu, median_role_level_day7, guild_member_share.
 */

import { z } from 'zod';
import { getJson, ServerClientError } from '../services/server-client.js';
import type { ToolContext } from '../types.js';

export const name = 'get_metric_benchmark';
export const description =
  'Fetch the internal portfolio percentile band and external published industry ' +
  'norm for one metric key (e.g. "arppu_vnd", "payer_conversion_rate"). Returns ' +
  '{ available, external, internal } — either side may be null. External norms ' +
  'carry their source + citation; internal bands carry their computed-at date. ' +
  'Call this for the metric a diagnosis has identified as the driver so ' +
  'the conclusion is benchmark-aware. If available is false, state plainly that ' +
  'no benchmark exists yet — do not fabricate one.';

export const inputSchema = {
  metric: z
    .string()
    .min(1)
    .describe('The metric key, e.g. "arppu_vnd" or "payer_conversion_rate".'),
};

interface BenchmarkResponse {
  metric: string;
  available: boolean;
  external: { value: number; unit: string; direction?: string; source: string; citation: string } | null;
  internal: { band: string; value: number; computedAt: string } | null;
}

type OkResult = { ok: true; benchmark: BenchmarkResponse };
type ErrResult = { ok: false; reason: 'engine-unavailable'; detail?: unknown };

export async function handler(
  args: { metric: string },
  ctx: ToolContext,
): Promise<OkResult | ErrResult> {
  try {
    const res = await getJson<BenchmarkResponse>(
      `/api/knowledge/benchmark?metric=${encodeURIComponent(args.metric)}`,
      ctx,
    );
    return { ok: true, benchmark: res };
  } catch (err) {
    if (err instanceof ServerClientError) {
      return { ok: false, reason: 'engine-unavailable', detail: { status: err.status, body: err.body } };
    }
    return { ok: false, reason: 'engine-unavailable', detail: String(err) };
  }
}
