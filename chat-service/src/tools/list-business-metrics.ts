/**
 * Tool: list_business_metrics
 * Returns the trimmed business-metric registry, optionally filtered by a
 * free-text query (substring match on id/label/synonyms) and/or tier number.
 */

import { z } from 'zod';
import { getJson, ServerClientError } from '../services/server-client.js';
import type { ToolContext } from '../types.js';

export const name = 'list_business_metrics';
export const description =
  'List available business metrics. Optionally filter by a search query ' +
  '(substring match on id, label, or synonyms) and/or by tier (1 or 2).';

export const inputSchema = {
  query: z.string().optional().describe('Substring to match against id, label, or synonyms'),
  tier: z.union([z.literal(1), z.literal(2)]).optional().describe('Filter to tier 1 or 2 only'),
};

// Shape returned by /api/business-metrics
interface MetricRaw {
  id: string;
  label: string;
  description: string;
  tier: number;
  formula: unknown;
  unit?: string;
  synonyms?: string[];
  game_compatibility?: unknown;
  [key: string]: unknown;
}

interface TrimmedMetric {
  id: string;
  label: string;
  description: string;
  tier: number;
  formula: unknown;
  unit?: string;
  game_compatibility?: unknown;
}

type OkResult = { ok: true; metrics: TrimmedMetric[] };
type ErrResult = { ok: false; error: 'server_error'; detail: { status: number; body: unknown } };

function trim(m: MetricRaw): TrimmedMetric {
  return {
    id: m.id,
    label: m.label,
    description: m.description,
    tier: m.tier,
    formula: m.formula,
    ...(m.unit !== undefined ? { unit: m.unit } : {}),
    ...(m.game_compatibility !== undefined ? { game_compatibility: m.game_compatibility } : {}),
  };
}

function matchesQuery(m: MetricRaw, q: string): boolean {
  const lq = q.toLowerCase();
  if (m.id.toLowerCase().includes(lq)) return true;
  if (m.label.toLowerCase().includes(lq)) return true;
  if (m.synonyms?.some((s) => s.toLowerCase().includes(lq))) return true;
  return false;
}

export async function handler(
  args: { query?: string; tier?: 1 | 2 },
  ctx: ToolContext,
): Promise<OkResult | ErrResult> {
  let raw: { metrics: MetricRaw[] };
  try {
    raw = await getJson<{ metrics: MetricRaw[] }>('/api/business-metrics', ctx);
  } catch (err) {
    if (err instanceof ServerClientError) {
      return { ok: false, error: 'server_error', detail: { status: err.status, body: err.body } };
    }
    return { ok: false, error: 'server_error', detail: { status: 0, body: String(err) } };
  }

  let metrics = raw.metrics ?? [];

  if (args.query) {
    metrics = metrics.filter((m) => matchesQuery(m, args.query!));
  }
  if (args.tier !== undefined) {
    metrics = metrics.filter((m) => m.tier === args.tier);
  }

  return { ok: true, metrics: metrics.map(trim) };
}
