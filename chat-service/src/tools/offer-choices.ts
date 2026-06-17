/**
 * Tool: offer_choices
 *
 * Lets the agent end a turn with a pre-crafted set of clickable answer chips
 * when its reply asks the user to choose among a small, enumerable set of
 * options (e.g. "Which metric should I rank by?" → Revenue / LTV / ARPU).
 *
 * It reuses the existing `disambig_options` SSE channel (same one the
 * deterministic disambiguate_query engine emits on), tagged with slot
 * 'choice'. The FE renders any disambig_options payload as a chip row and
 * auto-sends the picked option's pinText as the next turn — so this tool
 * needs no new FE event plumbing.
 *
 * Presentational only: it writes nothing to session memory. Each option's
 * pinText is a standalone next-turn instruction; when the user clicks, that
 * text runs through disambiguate_query as usual, which is where memory is
 * written. The tool is a no-op (but still returns cleanly) when no SSE
 * emitter is bound — e.g. during a cached-response replay.
 */

import { z } from 'zod';
import type { ToolContext } from '../types.js';

export const name = 'offer_choices';
export const description =
  'End your turn with clickable answer chips when your reply asks the user to choose among 2–6 ' +
  'discrete, enumerable options (a clarifying question, or "pick one of these candidates"). Call this ' +
  'as the FINAL action of the turn — do NOT also list the same options as prose, the UI renders them. ' +
  'Each option needs a short `label` (what the chip says) and a `pinText` (the message sent verbatim ' +
  'when the chip is clicked). pinText MUST be a self-contained, imperative instruction that encodes the ' +
  'chosen value AND the intent it resolves — e.g. label "Revenue" → pinText "Rank the top VIP players ' +
  'by Revenue (total recharge over the last 30 days)" — NOT a bare echo of the label. When the options ' +
  'are metrics to rank INDIVIDUALS by (top players/users), offer only per-entity amounts (revenue, ' +
  'lifetime value, sessions, playtime) — never population averages or rates (ARPU, ARPDAU, ARPPU, ' +
  'conversion/retention rate, DAU/MAU), which are cohort aggregates and meaningless per person. Do NOT ' +
  'call this for open-ended questions with no enumerable answer set.';

const optionSchema = z.object({
  label: z.string().min(1).max(60),
  pinText: z.string().min(1).max(300),
});

export const inputSchema = {
  prompt: z.string().min(1).max(200),
  options: z.array(optionSchema).min(2).max(6),
};

export async function handler(
  args: { prompt: string; options: Array<{ label: string; pinText: string }> },
  ctx: ToolContext,
): Promise<{ emitted: boolean; count: number }> {
  if (!ctx.sseEmitter) {
    return { emitted: false, count: args.options.length };
  }

  ctx.sseEmitter.emit('disambig_options', {
    slot: 'choice',
    prompt: args.prompt,
    // Confidence descends slightly by position so the FE can keep the agent's
    // ordering; values are presentational hints only.
    options: args.options.map((o, idx) => ({
      label: o.label,
      pinText: o.pinText,
      confidence: 1 - idx * 0.05,
    })),
  });

  return { emitted: true, count: args.options.length };
}
