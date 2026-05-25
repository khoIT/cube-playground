/**
 * Tool: disambiguate_query
 *
 * Pre-flight for any free-form analytical question. Calls the nl-to-query
 * engine, validates resolved Cube refs against /meta, bridges through
 * session memory (read prior slots + write what this turn confirmed), then
 * surfaces either a confident query the LLM can hand to preview_cube_query /
 * emit_query_artifact (action='auto') or a single bilingual clarification
 * (action='clarify'). The engine itself contains no LLM calls.
 */

import { z } from 'zod';
import * as cubeMetaCache from '../core/cube-meta-cache.js';
import { cubeHasTimeDimension, cubeNameOf } from '../core/cube-meta-capability.js';
import { disambiguate } from '../nl-to-query/index.js';
import type { DisambiguationResult, Clarification } from '../nl-to-query/index.js';
import { fillResultFromMemory, writeMemoryFromResult } from './disambiguate-memory-merge.js';
import { suggestTimeAwareAlternatives } from '../nl-to-query/time-aware-measure-suggester.js';
import type { ToolContext } from '../types.js';

export const name = 'disambiguate_query';
export const description =
  'Analyse the user message (VI/EN/code-switched), resolve metric/dimension/filter/timeRange/intent ' +
  'slots against the Official glossary, and return either action="auto" with a Cube query the agent ' +
  'should run, or action="clarify" with one bilingual clarification question. Always call this BEFORE ' +
  'preview_cube_query / emit_query_artifact. CALL IT ALSO on reply turns that supply a slot value ' +
  '(e.g. user replied "ARPU" or "by country" to a prior clarification) — session memory only ' +
  'persists when this tool runs.';

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
  const now = ctx.now ? ctx.now() : Date.now();

  let knownMembers: Set<string> | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let meta: any = null;
  try {
    meta = await cubeMetaCache.getMeta(ctx.gameId, ctx.cubeToken);
    knownMembers = cubeMetaCache.extractMemberNames(meta);
  } catch {
    knownMembers = undefined;
  }

  const result = await disambiguate(
    { message: args.message, mode, knownMembers },
    { now: () => now },
  );

  // Phase 1 — fill empty slots from memory so the validator sees the
  // user's prior context (e.g. timeRange set in a previous turn).
  const memoryParams = ctx.db
    ? { db: ctx.db, sessionId: ctx.sessionId, ownerId: ctx.ownerId, gameId: ctx.gameId, now }
    : null;
  if (memoryParams) fillResultFromMemory(result, memoryParams);

  // Validate: reject a snapshot measure × timeRange combination BEFORE the
  // memory write so the rejected metric does not leak into memory or prefs.
  if (meta) {
    rejectSnapshotMeasureUnderTimeRange(result, meta);
  }

  // Phase 2 — write every still-confident slot back to both memory layers.
  if (memoryParams) writeMemoryFromResult(result, memoryParams);

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

  // Emit structured chip data when we still need user input. The FE listens
  // for 'disambig_options' and renders clickable pills below the assistant
  // turn. We pick the most pressing clarification and translate its options
  // into pin-text the next turn can resolve cleanly.
  if (result.action === 'clarify' && ctx.sseEmitter) {
    const clar = pickPrimaryClarification(result.clarifications);
    if (clar && clar.options && clar.options.length > 0) {
      ctx.sseEmitter.emit('disambig_options', {
        slot: clar.slot === 'filters' || clar.slot === 'comparison' ? 'metric' : clar.slot,
        prompt: clar.question_en,
        options: clar.options.map((o, idx) => ({
          label: o.label_en,
          pinText: o.label_en,
          confidence: 1 - idx * 0.1,
        })),
      });
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

/**
 * When the user picked a measure on a cube with no time dimension while
 * `timeRange` is set, refuse the measure and surface up to three
 * similarly-named alternatives on time-aware cubes. The metric slot is
 * cleared (confidence=0) so memory writes don't persist the rejected ref.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rejectSnapshotMeasureUnderTimeRange(result: DisambiguationResult, meta: any): void {
  const metricRef = result.slots.metric.value;
  const timeRangeValue = result.slots.timeRange?.value;
  if (!metricRef || !timeRangeValue) return;
  const cubeName = cubeNameOf(metricRef);
  if (!cubeName || cubeHasTimeDimension(meta, cubeName)) return;

  const alternatives = suggestTimeAwareAlternatives(meta, metricRef, result.slots.metric.alias);
  result.warnings.push(
    `metric ${metricRef} has no time dimension on cube ${cubeName} — incompatible with the requested timeRange`,
  );
  // Clear the rejected metric so downstream code does not persist it.
  result.slots.metric = { value: undefined, confidence: 0, alias: result.slots.metric.alias };
  result.action = 'clarify';

  result.clarifications.push({
    slot: 'metric',
    question_en:
      alternatives.length > 0
        ? `That measure is a lifetime snapshot. Did you mean ${alternatives[0].label}?`
        : 'That measure does not support a time range. Pick a time-aware metric instead.',
    question_vi:
      alternatives.length > 0
        ? `Chỉ số này không có chiều thời gian. Bạn có ý là ${alternatives[0].label}?`
        : 'Chỉ số này không hỗ trợ lọc theo thời gian. Chọn chỉ số khác giúp mình nhé.',
    options:
      alternatives.length > 0
        ? alternatives.map((alt) => ({ value: alt.ref, label_en: alt.label, label_vi: alt.label }))
        : undefined,
  });
}

/** Pick the most actionable clarification (metric > dimension > timeRange). */
function pickPrimaryClarification(clarifications: Clarification[]): Clarification | null {
  if (clarifications.length === 0) return null;
  const order: Clarification['slot'][] = ['metric', 'dimension', 'timeRange', 'filters', 'comparison'];
  for (const slot of order) {
    const found = clarifications.find((c) => c.slot === slot);
    if (found) return found;
  }
  return clarifications[0];
}
