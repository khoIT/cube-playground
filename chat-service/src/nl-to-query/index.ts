/**
 * Disambiguation engine entry point. Orchestrates the per-step modules and
 * produces a single DisambiguationResult the LLM can act on.
 *
 * Engineering principle: NO LLM calls inside the engine. The LLM consumes
 * what we return and decides whether to ask the user or proceed.
 */

import { config } from '../config.js';
import { detectLanguage } from './language-detector.js';
import { fetchOfficialGlossary } from './glossary-client.js';
import { extractSlots } from './slot-extractor.js';
import { composeQuery, overallConfidence } from './query-composer.js';
import { buildClarifications } from './clarification-builder.js';
import { modeGate } from './mode-gate.js';
import type {
  DisambiguateContext,
  DisambiguateInput,
  DisambiguationResult,
} from './types.js';

export type {
  ChatDisambiguationMode,
  DisambiguateInput,
  DisambiguateContext,
  DisambiguationResult,
  DisambiguationSlots,
  Clarification,
  ClarificationOption,
  OfficialTerm,
} from './types.js';

export { detectLanguage } from './language-detector.js';
export { fetchOfficialGlossary, __resetGlossaryCache } from './glossary-client.js';
export { parseNumbers } from './number-normaliser.js';
export { resolveDateRanges } from './date-resolver.js';
export { resolveTerms, compileAliasIndex } from './synonym-resolver.js';
export { extractSlots } from './slot-extractor.js';
export { composeQuery, overallConfidence } from './query-composer.js';
export { buildClarifications } from './clarification-builder.js';
export { modeGate } from './mode-gate.js';

const DEFAULT_CONTEXT: DisambiguateContext = {
  now: () => Date.now(),
  fetchOfficialGlossary: () => fetchOfficialGlossary(),
};

export async function disambiguate(
  input: DisambiguateInput,
  ctx: Partial<DisambiguateContext> = {},
): Promise<DisambiguationResult> {
  const now = ctx.now ? ctx.now() : DEFAULT_CONTEXT.now();
  const fetchFn = ctx.fetchOfficialGlossary ?? DEFAULT_CONTEXT.fetchOfficialGlossary;

  const language = detectLanguage(input.message);
  const isViContext = language !== 'en';

  let glossary;
  try {
    glossary = await fetchFn();
  } catch (err) {
    // Engine never throws — surface as warning and return a low-confidence shell.
    return {
      query: {},
      slots: {
        metric: { confidence: 0 },
        intent: { value: 'aggregate', confidence: 0 },
      },
      unresolved: [input.message],
      clarifications: [],
      overallConfidence: 0,
      language,
      action: 'clarify',
      warnings: [`glossary fetch failed: ${(err as Error).message}`],
    };
  }

  const extracted = extractSlots({
    message: input.message,
    isVietnameseContext: isViContext,
    now,
    glossary,
    knownMembers: input.knownMembers,
  });

  const query = composeQuery({
    slots: extracted.slots,
    knownMembers: input.knownMembers,
  });

  const overall = overallConfidence(extracted.slots);

  const threshold = config.disambigAutoThreshold;
  const clarifications = buildClarifications({
    slots: extracted.slots,
    glossary,
    threshold,
  });

  const action = modeGate({
    mode: input.mode,
    overallConfidence: overall,
    clarifications,
    threshold,
  });

  return {
    query,
    slots: extracted.slots,
    unresolved: extracted.unresolved,
    clarifications,
    overallConfidence: overall,
    language,
    action,
    warnings: extracted.warnings,
  };
}
