/**
 * LLM refinement building blocks for per-game starter questions — prompt
 * construction, meta projection, strict output validation, and the one-shot
 * LLM caller. Consumed EXCLUSIVELY by scripts/pregenerate-starter-questions.ts;
 * there is deliberately no runtime refine pass anymore (per-environment LLM
 * runs produced different question sets, breaking the local↔prod consistency
 * contract — the checked-in seed file is the only LLM output path).
 *
 * Hard validation rule: every `targetCatalogIds` entry must exist in the
 * game's meta. An LLM set referencing even one invented member is rejected
 * wholesale — an invented member strands the user in a broken artifact.
 */

import { config } from '../config.js';
import type { StarterQuestion } from '../db/starter-questions-store.js';

const PERSONAS = new Set(['pm', 'marketer', 'analyst']);
const CATEGORIES = new Set(['explore', 'metric_explain', 'compare', 'diagnose']);

/** Mirrors the get_cube_meta tool budget — keeps the prompt well under model limits. */
const PROJECTION_CHAR_BUDGET = 60_000;

const MIN_VALID_QUESTIONS = 3;

interface ProjectedMember {
  cube: string;
  member: string;
  title?: string;
  description?: string;
  kind: 'measure' | 'dimension';
}

/**
 * Trim the meta to the fields the LLM needs: member names + titles +
 * descriptions. Over budget → drop descriptions; still over → truncate tail.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildMetaProjection(meta: any): ProjectedMember[] {
  const members: ProjectedMember[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cubes: any[] = meta?.cubes ?? [];
  for (const cube of cubes) {
    for (const m of cube.measures ?? []) {
      members.push({ cube: cube.name, member: m.name, title: m.title, description: m.description, kind: 'measure' });
    }
    for (const d of cube.dimensions ?? []) {
      members.push({ cube: cube.name, member: d.name, title: d.title, description: d.description, kind: 'dimension' });
    }
  }

  if (JSON.stringify(members).length <= PROJECTION_CHAR_BUDGET) return members;

  const noDesc = members.map(({ description: _omit, ...rest }) => rest as ProjectedMember);
  let projection = noDesc;
  while (projection.length > 1 && JSON.stringify(projection).length > PROJECTION_CHAR_BUDGET) {
    projection = projection.slice(0, Math.floor(projection.length / 2));
  }
  return projection;
}

export function buildRefinePrompt(
  projection: ProjectedMember[],
  baseline: StarterQuestion[],
): string {
  return [
    'You generate analytical starter questions for a game-analytics chatbot.',
    'The questions showcase the most meaningful business-performance analyses for THIS game,',
    'biased toward analyses that end in a SEGMENT/list (win-back lists, churn-risk payers, VIP outreach).',
    '',
    'available_members (the ONLY members that exist):',
    JSON.stringify(projection),
    '',
    'baseline_questions (deterministic seed — improve on these):',
    JSON.stringify(baseline),
    '',
    'RULES:',
    '- Output ONLY a JSON array. No prose, no code fences.',
    '- Each item: {"id": string, "text": string, "personaTags": string[], "categoryTags": string[], "targetCatalogIds": string[]}.',
    '- personaTags subset of ["pm","marketer","analyst"]; categoryTags subset of ["explore","metric_explain","compare","diagnose"].',
    '- targetCatalogIds MUST be "cube.member" names copied EXACTLY from available_members. NEVER invent a name.',
    '- 12-18 questions. Improve clarity and business relevance over the baseline; keep good baseline items.',
    '- Question text in English, concrete and answerable from the listed members.',
  ].join('\n');
}

/**
 * Parse the LLM output and keep only items that pass every check. Returns
 * null when the whole set must be rejected (parse failure, or fewer than
 * MIN_VALID_QUESTIONS survive).
 */
export function parseAndValidateLlmSet(
  raw: string,
  knownMembers: Set<string>,
): StarterQuestion[] | null {
  const unfenced = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const valid: StarterQuestion[] = [];
  for (const item of parsed) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const x = item as any;
    if (typeof x?.id !== 'string' || !x.id.trim()) continue;
    if (typeof x?.text !== 'string' || !x.text.trim()) continue;
    if (!Array.isArray(x.personaTags) || x.personaTags.length === 0) continue;
    if (!x.personaTags.every((p: unknown) => typeof p === 'string' && PERSONAS.has(p))) continue;
    if (!Array.isArray(x.categoryTags) || x.categoryTags.length === 0) continue;
    if (!x.categoryTags.every((c: unknown) => typeof c === 'string' && CATEGORIES.has(c))) continue;
    if (!Array.isArray(x.targetCatalogIds) || x.targetCatalogIds.length === 0) continue;
    // Invented member ⇒ reject the WHOLE set: a partially-hallucinating
    // response is untrustworthy beyond the specific bad item.
    if (!x.targetCatalogIds.every((t: unknown) => typeof t === 'string' && knownMembers.has(t))) {
      return null;
    }
    valid.push({
      id: x.id.trim(),
      text: x.text.trim(),
      personaTags: x.personaTags,
      categoryTags: x.categoryTags,
      targetCatalogIds: x.targetCatalogIds,
    });
  }
  return valid.length >= MIN_VALID_QUESTIONS ? valid : null;
}

/**
 * One-shot Agent-SDK call with no tools, same wiring as the title summariser.
 * Used by the pregenerate script only.
 */
export async function defaultCallLlm(prompt: string): Promise<string> {
  const { query: sdkQuery } = await import('@anthropic-ai/claude-agent-sdk');
  let result = '';
  for await (const msg of sdkQuery({
    prompt,
    options: {
      model: config.starterRefinerModel,
      env: {
        HOME: process.env['HOME'] ?? '/tmp',
        ANTHROPIC_API_KEY: config.anthropicApiKey,
        ANTHROPIC_BASE_URL: config.anthropicBaseUrl,
      },
      permissionMode: 'dontAsk',
      disallowedTools: ['Read', 'Write', 'Bash', 'WebFetch', 'WebSearch', 'Edit', 'MultiEdit'],
    },
  })) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = msg as any;
    if (m.type === 'result') result = m.result ?? '';
  }
  return result;
}
