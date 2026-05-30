/**
 * LLM enrichment for draft cube models — the toggleable "intelligence" layer on
 * top of the heuristic v1. Given an inferred cube + column samples, an LLM
 * produces business-friendly labels, descriptions, and synonyms GROUNDED in the
 * sampled values. Output is Zod-validated and filtered to members that actually
 * exist in the draft (hallucinated members are dropped, never applied).
 *
 * Feature-flagged: `onboarding.llmEnrichment` (default OFF). When off — or when
 * the LiteLLM gateway is unconfigured — `enrichCube` returns an empty
 * suggestion set and the heuristic v1 is unchanged. Suggestions are NEVER
 * auto-applied; the DA accepts them in the canvas.
 *
 * Talks to the LiteLLM gateway over fetch (no SDK dep), mirroring the env
 * already documented in `.env.example` (LITELLM_BASE_URL / _API_KEY_* / _MODEL).
 */

import { z } from 'zod';
import { getSetting } from './app-settings-store.js';
import type { InferredCube } from '../types/raw-schema.js';

const SuggestionSchema = z.object({
  member: z.string(),
  label: z.string().max(120),
  description: z.string().max(400),
  synonyms: z.array(z.string().max(60)).max(8).default([]),
});
const ResponseSchema = z.object({ members: z.array(SuggestionSchema).max(100) });

export type MemberSuggestion = z.infer<typeof SuggestionSchema>;

export function isEnrichmentEnabled(): boolean {
  return getSetting<boolean>('onboarding.llmEnrichment', false) === true;
}

function gatewayConfig(): { baseUrl: string; apiKey: string; model: string } | null {
  const baseUrl = process.env.LITELLM_BASE_URL;
  const apiKey = process.env.LITELLM_API_KEY_DEV || process.env.LITELLM_API_KEY_STG;
  const model = process.env.LITELLM_MODEL ?? 'claude-sonnet-4-6';
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey, model };
}

function buildPrompt(cube: InferredCube): string {
  const lines = cube.fields
    .filter((f) => f.role !== 'ignore')
    .map((f) => `- ${f.column} (${f.role}, ${f.dataType})`);
  return [
    `You are naming members of a data cube derived from warehouse table "${cube.sqlTable}".`,
    `For EACH column below, propose a business-friendly label, a one-sentence description, and up to 4 synonyms.`,
    `Ground every description in the column name + type; do NOT invent columns that are not listed.`,
    `Return STRICT JSON: {"members":[{"member","label","description","synonyms":[]}]}. "member" MUST equal the column name verbatim.`,
    ``,
    `Columns:`,
    ...lines,
  ].join('\n');
}

/**
 * Enrich one inferred cube. Returns suggestions keyed by the draft's column
 * names; any member the model invents that isn't in the cube is discarded.
 * Returns `[]` when disabled / unconfigured / on any failure (never throws into
 * the request path).
 */
export async function enrichCube(cube: InferredCube): Promise<MemberSuggestion[]> {
  if (!isEnrichmentEnabled()) return [];
  const cfg = gatewayConfig();
  if (!cfg) return [];

  const validColumns = new Set(cube.fields.map((f) => f.column));

  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages: [
          { role: 'system', content: 'You output only strict JSON. No prose, no code fences.' },
          { role: 'user', content: buildPrompt(cube) },
        ],
      }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = ResponseSchema.safeParse(JSON.parse(stripFences(content)));
    if (!parsed.success) return [];
    // Drop hallucinated members — only keep those present in the draft.
    return parsed.data.members.filter((m) => validColumns.has(m.member));
  } catch {
    return [];
  }
}

/** Strip ```json fences a model might add despite instructions. */
function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}
