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
import { config } from '../config.js';
import { fetchOfficialGlossary } from '../nl-to-query/glossary-client.js';
import { findExactMatch } from '../nl-to-query/synonym-resolver.js';
import { firstCubeRef } from '../nl-to-query/recognise-cube-ref.js';
import { resolveBestConcept } from '../nl-to-query/concept-resolver.js';
import { buildLeaderboardQuery } from '../nl-to-query/leaderboard-path.js';
import type { CubeQuery, ToolContext } from '../types.js';

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

/**
 * Phase 02a — disclosure payload returned alongside an auto-routed query
 * when the resolver had to pick between several plausible interpretations.
 * The skill body renders this as a single-line footer the user can override
 * with "not that".
 */
export interface ResolutionAssumption {
  slot: 'metric' | 'concept' | 'entity';
  chosen: string;
  phrase: string;
  confidence: number;
  alternatives: Array<{ id: string; score: number }>;
  /**
   * Phase 02a sub-deliverable D — when the assumption was filled from the
   * cross-session preference table (not this turn's resolver), the skill
   * body renders an explicit-history footer rather than the standard
   * "interpreted X as Y" disclosure. Drift mitigation: stale prefs become a
   * one-word fix ("not that") instead of a silent regression.
   */
  source?: 'cross-session';
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
  assumption?: ResolutionAssumption;
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

  // Phase 02a — v2 resolver layer. Three short-circuits (cube ref, exact alias,
  // rankable concept + leaderboard intent) skip the clarify list when the user
  // has already typed something unambiguous. Flag-gated; falls through to the
  // existing engine otherwise. Builds `assumption` for the concept path so the
  // skill body can render the disclosure footer.
  let assumption: ResolutionAssumption | undefined;
  if (config.chatGlossaryV2Enabled) {
    assumption = await applyGlossaryV2(result, args.message, knownMembers);
  }

  // Phase 1 — fill empty slots from memory so the validator sees the
  // user's prior context (e.g. timeRange set in a previous turn).
  const memoryParams = ctx.db
    ? { db: ctx.db, sessionId: ctx.sessionId, ownerId: ctx.ownerId, gameId: ctx.gameId, now }
    : null;
  if (memoryParams) fillResultFromMemory(result, memoryParams);

  // Phase 02a sub-deliverable D — replay path: if memory carried forward
  // intent=leaderboard + concept, rebuild the entity-ranked query now that
  // this turn's metric/measure is pinned. Synthesises the assumption when
  // the v2 layer above couldn't (because the current message had no
  // concept phrase).
  if (config.chatGlossaryV2Enabled && !assumption) {
    assumption = await retryLeaderboardFromMemory(result);
  }

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
    ...(assumption ? { assumption } : {}),
  };
}

/**
 * Phase 02a — short-circuit the clarify list when the user has already typed
 * something unambiguous. Mutates `result` in place; returns the assumption
 * payload when the concept-resolver took the leaderboard path (the other two
 * short-circuits don't need disclosure since the user was explicit).
 */
async function applyGlossaryV2(
  result: DisambiguationResult,
  message: string,
  knownMembers: Set<string> | undefined,
): Promise<ResolutionAssumption | undefined> {
  // 1. Fully-qualified cube ref — `recharge.revenue_vnd` style.
  const refHit = firstCubeRef(message, knownMembers);
  if (refHit) {
    result.slots.metric = {
      value: refHit.hit.cubeRef,
      alias: refHit.hit.cubeRef,
      confidence: 1.0,
      span: refHit.hit.span,
    };
    result.action = 'auto';
    result.clarifications = [];
    return undefined;
  }

  // 2. Exact id / label / alias match — user typed a term verbatim.
  let glossary;
  try {
    glossary = await fetchOfficialGlossary();
  } catch {
    return undefined;
  }
  const exact = findExactMatch(message, glossary);
  if (exact) {
    // Concept terms carry a separate `defaultMeasureRef` (the actual cube
    // member) distinct from `primaryCatalogId` (a catalog path like
    // `business_metrics/paying_users`). Prefer the cube ref so the meta
    // validator downstream accepts it.
    const cubeRef = exact.term.defaultMeasureRef ?? exact.term.primaryCatalogId ?? exact.term.id;
    result.slots.metric = {
      value: cubeRef,
      alias: message.trim(),
      confidence: 1.0,
    };
    result.action = 'auto';
    result.clarifications = [];
    return undefined;
  }

  // 3. Rankable concept + leaderboard intent → entity-rank query.
  const intent = result.slots.intent?.value;
  if (intent !== 'leaderboard') return undefined;

  const conceptResolution = resolveBestConcept(message, glossary);
  if (!conceptResolution) return undefined;
  const threshold = config.chatGlossaryAutorouteThreshold;
  if (conceptResolution.confidence < threshold) return undefined;
  if (conceptResolution.gap < 0.2) return undefined;

  const concept = conceptResolution.best.term;
  // Inherit timeRange (and limit hint) from the engine's slot extraction.
  const timeRangeValue = result.slots.timeRange?.value;
  const granularity = result.slots.timeRange?.granularity as
    | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year' | undefined;
  const built = buildLeaderboardQuery({
    concept,
    timeRange: timeRangeValue
      ? { dateRange: timeRangeValue, granularity }
      : undefined,
    limit: result.slots.limit,
  });
  if (!built.rankable) return undefined;

  // Replace the engine's draft query and pin the metric slot.
  result.query = built.query as CubeQuery;
  if (concept.defaultMeasureRef) {
    result.slots.metric = {
      value: concept.defaultMeasureRef,
      alias: conceptResolution.best.alias,
      confidence: conceptResolution.confidence,
      span: conceptResolution.best.span,
    };
  }
  // Write concept + entity slots too so memory carries the leaderboard
  // shape across turns (sub-deliverable D — replay of session b93d68e4).
  result.slots.concept = {
    value: concept.id,
    alias: conceptResolution.best.alias,
    confidence: conceptResolution.confidence,
  };
  if (concept.entityCube && concept.entityPk) {
    result.slots.entity = {
      value: { cube: concept.entityCube, pk: concept.entityPk },
      alias: conceptResolution.best.alias,
      confidence: conceptResolution.confidence,
    };
  }
  result.action = 'auto';
  result.clarifications = [];

  return {
    slot: 'concept',
    chosen: concept.id,
    phrase: conceptResolution.best.alias,
    confidence: conceptResolution.confidence,
    alternatives: conceptResolution.secondBest
      ? [{ id: conceptResolution.secondBest.conceptId, score: conceptResolution.secondBest.score }]
      : [],
  };
}

/**
 * Phase 02a sub-deliverable D — retry the leaderboard path AFTER memory has
 * been merged. Handles the b93d68e4 replay case: turn 0 (clarify) wrote
 * intent=leaderboard + concept=spender + entity=players into memory; turn 2's
 * reply ("Revenue") merges those back and we now have enough to emit a
 * leaderboard query without re-asking.
 *
 * Source attribution: if the cross-session marker
 * (`[cross_session_pref] concept:…`) appears in warnings, the assumption is
 * tagged so the skill body renders the always-disclose footer.
 */
async function retryLeaderboardFromMemory(
  result: DisambiguationResult,
): Promise<ResolutionAssumption | undefined> {
  if (!config.chatGlossaryV2Enabled) return undefined;
  const intentSlot = result.slots.intent;
  const conceptSlot = result.slots.concept;
  if (intentSlot?.value !== 'leaderboard') return undefined;
  if (!conceptSlot?.value) return undefined;

  // If the v2 layer already built the leaderboard query this turn (entity
  // dim present in query.dimensions) there is nothing to retry.
  if (result.query.dimensions && result.query.dimensions.length > 0) return undefined;

  let glossary;
  try {
    glossary = await fetchOfficialGlossary();
  } catch {
    return undefined;
  }
  const concept = glossary.find((t) => t.id === conceptSlot.value);
  if (!concept) return undefined;

  const timeRangeValue = result.slots.timeRange?.value;
  const granularity = result.slots.timeRange?.granularity as
    | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year' | undefined;
  const built = buildLeaderboardQuery({
    concept,
    timeRange: timeRangeValue ? { dateRange: timeRangeValue, granularity } : undefined,
    limit: result.slots.limit,
  });
  if (!built.rankable) return undefined;

  result.query = built.query as CubeQuery;
  result.action = 'auto';
  result.clarifications = [];

  const fromCrossSession = result.warnings.some((w) =>
    w.startsWith('[cross_session_pref] concept:') ||
    w.startsWith('[cross_session_pref] intent:'),
  );

  return {
    slot: 'concept',
    chosen: concept.id,
    phrase: conceptSlot.alias ?? concept.label,
    confidence: conceptSlot.confidence,
    alternatives: [],
    ...(fromCrossSession ? { source: 'cross-session' as const } : {}),
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
