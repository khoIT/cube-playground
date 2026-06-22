/**
 * Tool: emit_verdict
 *
 * The LLM calls this once, first, when answering a substantive data-backed
 * analytical question — to state the single takeaway up front. The frontend
 * renders it as a lead block above the answer body so the turn opens with the
 * conclusion and the charts read as supporting evidence.
 *
 * Handler:
 *   1. Trims + length-guards the headline / rationale.
 *   2. Emits a 'verdict' SSE event via ctx.sseEmitter (captured + persisted in
 *      turn.ts, mirroring emit_query_artifact / propose_segment).
 *   3. Returns { ok: true } or { ok: false, error, detail }.
 *
 * Do NOT call this for pure clarification/disambiguation turns or chit-chat —
 * only when there is a real answer grounded in data.
 */

import { z } from 'zod';
import type { ToolContext, VerdictData } from '../types.js';

export const name = 'emit_verdict';
export const description =
  'State the single headline takeaway of a data-backed analytical answer. Call this ' +
  'ONCE and FIRST, before composing the body, whenever you are answering a substantive ' +
  'question with data — the headline is the one-sentence answer, the optional rationale ' +
  'is a 1–2 sentence "why". The body then frames the supporting evidence. Do NOT call it ' +
  'for clarification/disambiguation turns or chit-chat.';

export const inputSchema = {
  headline: z
    .string()
    .min(1)
    .max(180)
    .describe('One sentence — the answer / takeaway itself (≤ ~90 chars reads best).'),
  rationale: z
    .string()
    .max(400)
    .optional()
    .describe('Optional 1–2 sentences of supporting "why" (≤ ~280 chars reads best).'),
};

interface OkResult {
  ok: true;
}

interface ErrorResult {
  ok: false;
  error: 'invalid_verdict';
  detail: string;
}

export async function handler(
  args: { headline: string; rationale?: string },
  ctx: ToolContext,
): Promise<OkResult | ErrorResult> {
  try {
    const headline = (args.headline ?? '').trim();
    if (!headline) {
      return { ok: false, error: 'invalid_verdict', detail: 'headline is required' };
    }
    const rationale = args.rationale?.trim() || undefined;
    const data: VerdictData = { headline, ...(rationale ? { rationale } : {}) };
    ctx.sseEmitter.emit('verdict', data);
    return { ok: true };
  } catch (err: unknown) {
    // Never let an exception escape and stall the agent loop.
    return {
      ok: false,
      error: 'invalid_verdict',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
