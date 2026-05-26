/**
 * Tool: emit_chart
 *
 * The LLM calls this tool when it has tabular result data and wants to render
 * an inline chart in the assistant message — independent of a query artifact.
 *
 * Handler:
 *   1. Validates the ChartSpec via Zod (the SDK runs the schema before calling).
 *   2. Applies top-N truncation; the "Other" lump preserves the value sum.
 *   3. Emits a 'chart' SSE event via ctx.sseEmitter (side-effect for client + persistence).
 *   4. Returns { ok: true, id, truncated } or { ok: false, error, detail }.
 *
 * Use emit_query_artifact's `chart` field instead when the chart describes the
 * same data as a query artifact — one card per question.
 */

import { z } from 'zod';
import {
  ChartSpecSchema,
  buildChartArtifact,
} from '../services/chart-spec.js';
import type { ToolContext } from '../types.js';

export const name = 'emit_chart';
export const description =
  'Render an inline chart from tabular data the assistant has just summarised. ' +
  'Use this for LLM-derived rollups (groupings the assistant built itself). ' +
  'When the chart describes the same data as a query artifact you are about to ' +
  'emit, pass `chart` to emit_query_artifact instead — one card per question.';

export const inputSchema = {
  spec: ChartSpecSchema.describe(
    'Declarative chart spec. Pick `type` from: bar, horizontal-bar, stacked-bar, grouped-bar, line, multi-line, area, pie, donut, scatter, funnel. ' +
      '`encoding.series` is required for stacked-bar, grouped-bar, and multi-line. ' +
      'For comparing a small number of discrete series (e.g. iOS vs Android) prefer grouped-bar — side-by-side bars read as a direct magnitude comparison, clearer than stacked (part-of-whole) or multi-line. ' +
      'For ordered conversion steps (e.g. ordered_event_funnel: step_name + step_count) prefer funnel — `category` is the step label, `value` the count; order rows by the step index, not by value.',
  ),
  artifactRef: z
    .string()
    .optional()
    .describe(
      'Optional id of a query_artifact emitted earlier in this turn that this chart belongs to. ' +
        'Prefer the inline `chart` field on emit_query_artifact when possible — only use this when the chart was assembled after the artifact.',
    ),
};

interface OkResult {
  ok: true;
  id: string;
  truncated: boolean;
}

interface ErrorResult {
  ok: false;
  error: 'invalid_spec';
  detail: string;
}

export async function handler(
  args: {
    spec: z.infer<typeof ChartSpecSchema>;
    artifactRef?: string;
  },
  ctx: ToolContext,
): Promise<OkResult | ErrorResult> {
  try {
    // The SDK has already run the Zod schema; this safeParse is a defensive
    // net for direct invocations (handler tests) and for catching shape errors
    // the SDK's pre-validation may have missed.
    const parsed = ChartSpecSchema.safeParse(args.spec);
    if (!parsed.success) {
      return {
        ok: false,
        error: 'invalid_spec',
        detail: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      };
    }

    const artifact = buildChartArtifact(parsed.data, { artifactRef: args.artifactRef });
    ctx.sseEmitter.emit('chart', artifact);
    return { ok: true, id: artifact.id, truncated: artifact.truncated };
  } catch (err: unknown) {
    // Catch-all: never let an exception escape and stall the agent loop.
    // The LLM gets a structured error and can recover (skip chart, retry).
    return {
      ok: false,
      error: 'invalid_spec',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
