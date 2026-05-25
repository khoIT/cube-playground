/**
 * Tool: disambiguate_query
 *
 * Pre-flight for any free-form analytical question. Calls the nl-to-query
 * engine, validates resolved Cube refs against /meta, then surfaces either
 * a confident query the LLM can hand to preview_cube_query / emit_query_artifact
 * (action='auto') or a single bilingual clarification (action='clarify').
 *
 * The engine itself contains no LLM calls — this tool wraps it so the
 * Claude runner can compose with the existing tool registry.
 */

import { z } from 'zod';
import * as cubeMetaCache from '../core/cube-meta-cache.js';
import { disambiguate } from '../nl-to-query/index.js';
import type { DisambiguationResult } from '../nl-to-query/index.js';
import type { ToolContext } from '../types.js';

export const name = 'disambiguate_query';
export const description =
  'Analyse the user message (VI/EN/code-switched), resolve metric/dimension/filter/timeRange ' +
  'slots against the Official glossary, and return either action="auto" with a Cube query the agent ' +
  'should run, or action="clarify" with one bilingual clarification question. Always call this BEFORE ' +
  'preview_cube_query / emit_query_artifact for free-form analytical questions.';

export const inputSchema = {
  message: z.string().min(1).max(2000),
  mode: z.enum(['targeted', 'aggressive']).optional(),
};

interface MissingRefIssue {
  slot: 'metric' | 'dimension' | 'filters';
  ref: string;
}

function collectRefsToValidate(result: DisambiguationResult): MissingRefIssue[] {
  const issues: MissingRefIssue[] = [];
  if (result.slots.metric.value) issues.push({ slot: 'metric', ref: result.slots.metric.value });
  if (result.slots.dimension?.value) issues.push({ slot: 'dimension', ref: result.slots.dimension.value });
  for (const f of result.slots.filters ?? []) issues.push({ slot: 'filters', ref: f.member });
  return issues;
}

export async function handler(
  args: { message: string; mode?: 'targeted' | 'aggressive' },
  ctx: ToolContext,
): Promise<{
  action: DisambiguationResult['action'];
  query: DisambiguationResult['query'];
  overallConfidence: number;
  slots: DisambiguationResult['slots'];
  clarifications: DisambiguationResult['clarifications'];
  unresolved: string[];
  language: DisambiguationResult['language'];
  warnings: string[];
}> {
  const mode = args.mode ?? ctx.disambiguationMode ?? 'targeted';

  let knownMembers: Set<string> | undefined;
  try {
    const meta = await cubeMetaCache.getMeta(ctx.gameId, ctx.cubeToken);
    knownMembers = cubeMetaCache.extractMemberNames(meta);
  } catch {
    knownMembers = undefined;
  }

  const result = await disambiguate(
    { message: args.message, mode, knownMembers },
    { now: ctx.now },
  );

  // Force a clarification if any resolved ref is unknown to Cube /meta —
  // we'd rather ask the user than send a query Cube will reject downstream.
  if (knownMembers) {
    const missing = collectRefsToValidate(result).filter((i) => !knownMembers!.has(i.ref));
    if (missing.length > 0) {
      result.action = 'clarify';
      result.warnings.push(
        `unresolved cube refs: ${missing.map((m) => `${m.slot}:${m.ref}`).join(', ')}`,
      );
      if (result.clarifications.length === 0) {
        result.clarifications.push({
          slot: missing[0].slot === 'metric' ? 'metric' : missing[0].slot === 'dimension' ? 'dimension' : 'filters',
          question_en: 'I could not find that in the data model. Which one did you mean?',
          question_vi: 'Mình không tìm thấy chỉ số đó. Bạn muốn dùng cái nào?',
        });
      }
    }
  }

  return {
    action: result.action,
    query: result.query,
    overallConfidence: result.overallConfidence,
    slots: result.slots,
    clarifications: result.clarifications,
    unresolved: result.unresolved,
    language: result.language,
    warnings: result.warnings,
  };
}
