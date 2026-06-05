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
import { matchStarterQuestion } from './disambiguate-starter-passthrough.js';
import { suggestTimeAwareAlternatives } from '../nl-to-query/time-aware-measure-suggester.js';
import { config } from '../config.js';
import { fetchOfficialGlossary } from '../nl-to-query/glossary-client.js';
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
  // Ratio metric carries no single ref — validate BOTH members so a
  // half-valid pair (one member missing from /meta) clarifies rather than
  // sending a broken two-measure query to Cube.
  if (result.slots.ratio) {
    issues.push({ slot: 'metric', ref: result.slots.ratio.numerator });
    issues.push({ slot: 'metric', ref: result.slots.ratio.denominator });
  }
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
    meta = await cubeMetaCache.getMeta(ctx.gameId, ctx.workspace);
    knownMembers = cubeMetaCache.extractMemberNames(meta);
  } catch {
    knownMembers = undefined;
  }

  // Pregenerated starter-question pass-through: a clicked chip matches a
  // frozen seed question whose target members are already meta-validated —
  // skip glossary resolution and pin them directly. The glossary cannot see
  // many of these members (e.g. match/mode engagement measures), and the
  // engine would otherwise emit an off-topic canned clarification.
  const starterHit = matchStarterQuestion(args.message, ctx.gameId, meta, knownMembers);
  if (starterHit) {
    return {
      action: 'auto',
      query: starterHit.query,
      overallConfidence: 1,
      slots: {
        metric: { value: starterHit.measures[0], confidence: 1, alias: args.message },
        intent: { value: 'aggregate', confidence: 1 },
      },
      clarifications: [],
      unresolved: [],
      language: 'en',
      warnings: [`matched pregenerated starter question: ${starterHit.questionId} — members pre-validated, proceed to preview`],
    };
  }

  const result = await disambiguate(
    { message: args.message, mode, knownMembers },
    { now: () => now },
  );

  // Kill-switch rollback: restore the pre-consolidation contract (metric ref =
  // catalog path), which the /meta gate rejects → clarify. Lets ops fall back
  // to the prior behavior for one release if the unified resolver regresses.
  if (config.chatGlossaryLegacy) {
    await applyLegacyRefContract(result);
  }

  // Explicit reference → never round-trip through clarification. A fully-
  // qualified cube ref or a verbatim term match is unambiguous, so auto-route
  // it even in targeted mode (the engine would otherwise clarify a missing
  // time range). The /meta gate below can still flip this to clarify if the
  // member is absent — an explicit but invalid ref must not auto-run.
  const matchedOn = result.resolution?.matchedOn;
  if (!config.chatGlossaryLegacy && (matchedOn === 'cube-ref' || matchedOn === 'exact')) {
    result.action = 'auto';
    result.clarifications = [];
  }

  let assumption: ResolutionAssumption | undefined;

  // Fill empty slots from memory so the validator (and the leaderboard builder
  // below) see the user's prior context (e.g. timeRange or concept set on a
  // previous turn).
  const memoryParams = ctx.db
    ? { db: ctx.db, sessionId: ctx.sessionId, ownerId: ctx.ownerId, gameId: ctx.gameId, now }
    : null;
  if (memoryParams) fillResultFromMemory(result, memoryParams);

  // Leaderboard assembly (always on). The resolver pins concept+entity on the
  // current turn; memory backfills them on a follow-up reply. Either way, once
  // intent=leaderboard + a rankable concept are present we build the
  // entity-ranked query here — the engine can't, since the entity dimension
  // was never typed. Also builds the disclosure assumption.
  if (!config.chatGlossaryLegacy) {
    assumption = await buildLeaderboardQueryFromConcept(result);
  }

  // Validate: reject a snapshot measure × timeRange combination BEFORE the
  // memory write so the rejected metric does not leak into memory or prefs.
  if (meta) {
    rejectSnapshotMeasureUnderTimeRange(result, meta);
  }

  // Phase 2 — write every still-confident slot back to both memory layers.
  if (memoryParams) writeMemoryFromResult(result, memoryParams);

  // Safety net: now that resolved refs are always cube members, a member the
  // game's /meta lacks means a genuine catalog/meta mismatch (renamed member,
  // cube absent for this game) — clarify rather than send a query Cube rejects.
  // The warning names the missing member so ops can fix the catalog/seed.
  if (knownMembers) {
    const missing = collectRefsToValidate(result).filter((i) => !knownMembers!.has(i.ref));
    if (missing.length > 0) {
      result.action = 'clarify';
      result.warnings.push(
        `unresolved cube refs: ${missing.map((m) => `${m.slot}:${m.ref}`).join(', ')}`,
      );
      if (result.clarifications.length === 0) {
        const missingMembers = [...new Set(missing.map((m) => m.ref))].join(', ');
        result.clarifications.push({
          slot: missing[0].slot === 'metric' ? 'metric' : missing[0].slot === 'dimension' ? 'dimension' : 'filters',
          question_en: `"${missingMembers}" isn't available in this game's data model. Which one did you mean?`,
          question_vi: `"${missingMembers}" không có trong mô hình dữ liệu của game này. Bạn muốn dùng cái nào?`,
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
 * Assemble the entity-ranked leaderboard query when intent=leaderboard and a
 * rankable concept is pinned. Serves two cases with one code path:
 *   - current turn: the unified resolver set concept+entity slots from the
 *     message ("top spenders this week");
 *   - replay: memory backfilled concept+entity from a prior turn, and this
 *     turn's reply ("Revenue") merged them in.
 * Mutates `result` in place; returns the disclosure assumption.
 *
 * Source attribution: a `[cross_session_pref]` marker in warnings tags the
 * assumption so the skill body renders the always-disclose footer.
 */
async function buildLeaderboardQueryFromConcept(
  result: DisambiguationResult,
): Promise<ResolutionAssumption | undefined> {
  const conceptSlot = result.slots.concept;
  if (result.slots.intent?.value !== 'leaderboard') return undefined;
  if (!conceptSlot?.value) return undefined;
  // Only auto-route a leaderboard above the threshold; an ambiguous concept
  // (low confidence) must stay a clarify rather than be forced to auto here.
  if (conceptSlot.confidence < config.chatGlossaryAutorouteThreshold) return undefined;
  // If a query already carries an explicit entity dimension (e.g. user typed
  // "by country"), respect it — nothing to assemble.
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
 * Kill-switch helper: rewrite the resolved metric back to its catalog path so
 * the /meta gate rejects it and forces a clarification — the behavior before
 * the resolver consolidation. Strips the consolidated ratio/concept slots so
 * the legacy path doesn't auto-route a ratio or leaderboard. Removed once the
 * unified resolver has soaked one release.
 */
async function applyLegacyRefContract(result: DisambiguationResult): Promise<void> {
  const termId = result.resolution?.termId;
  let glossary;
  try {
    glossary = await fetchOfficialGlossary();
  } catch {
    glossary = null;
  }
  if (termId && glossary) {
    const term = glossary.find((t) => t.id === termId);
    if (term?.primaryCatalogId) {
      result.slots.metric = { ...result.slots.metric, value: term.primaryCatalogId };
    }
  }
  delete result.slots.ratio;
  delete result.slots.concept;
  delete result.slots.entity;
  delete result.resolution;
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
