/**
 * LLM building blocks for the per-game topic knowledge bank — a LONGER layer
 * than the 6-per-topic starter chips: extra verified questions plus the
 * common metrics each topic can serve from the game's current data model.
 * Consumed exclusively by scripts/pregenerate-topic-knowledge.ts.
 *
 * Question candidates reuse parseAndValidateLlmSet (same hard rule: one
 * invented member rejects the whole set). Metric candidates are validated
 * individually — a bad metric row is dropped, not fatal, because metrics are
 * descriptive ("watch this") rather than clickable executables.
 */

import type { StarterQuestion } from '../db/starter-questions-store.js';
import type { KnowledgeMetric, KnowledgeTopic } from '../db/game-topic-knowledge-seed.js';
import { KNOWLEDGE_TOPICS } from '../db/game-topic-knowledge-seed.js';
import { MAX_QUESTION_TEXT_CHARS, STYLE_EXEMPLARS } from './starter-question-refiner.js';

/** Bank size per topic, including the shipped starter questions. */
export const KNOWLEDGE_QUESTIONS_PER_TOPIC = 12;
/** Extra candidates requested per topic beyond the shipped starters. */
export const EXTRA_CANDIDATES_PER_TOPIC = 10;
export const METRICS_PER_TOPIC = 8;

interface ProjectedMemberLike {
  cube: string;
  member: string;
  title?: string;
  description?: string;
  kind: 'measure' | 'dimension';
}

export function buildKnowledgePrompt(
  projection: ProjectedMemberLike[],
  shippedQuestions: StarterQuestion[],
  coverage: Record<string, string>,
  todayIso: string,
): string {
  return [
    'You curate the KNOWLEDGE BANK for a game-analytics chatbot used by a game PUBLISHING company.',
    'The bank powers orientation answers ("what should I know about revenue / liveops for this',
    'game?") and suggestion lists — broader than the small starter-chip set, but every entry must',
    'still be answerable by the data model below.',
    '',
    'available_members (the ONLY members that exist):',
    JSON.stringify(projection),
    '',
    'shipped_questions (already curated & verified — your additions must NOT duplicate these):',
    JSON.stringify(shippedQuestions.map((q) => ({ text: q.text, topicTags: q.topicTags }))),
    '',
    `today: ${todayIso}`,
    'data_coverage (latest date that HAS data per time dimension — pipelines lag behind today):',
    JSON.stringify(coverage),
    '',
    'OUTPUT — a single JSON object, no prose, no code fences:',
    '{',
    '  "questions": [ {"id": string, "text": string, "topicTags": string[], "categoryTags": string[], "targetCatalogIds": string[]}, ... ],',
    '  "metrics":   [ {"member": string, "title": string, "why": string, "topic": string}, ... ]',
    '}',
    '',
    'style_exemplars (the phrasing baseline — adapt the SHAPE to this game\'s actual members):',
    JSON.stringify(STYLE_EXEMPLARS),
    '',
    'STYLE — every question must read like a report headline, exactly like style_exemplars:',
    `- SHORT: at most ${MAX_QUESTION_TEXT_CHARS} characters. Longer texts are dropped before verification.`,
    '- ONE ask per question. NEVER compound two-part phrasing ("…, and how has X shifted…").',
    '- Punchy noun-phrase or a single direct question; no scene-setting prose.',
    '',
    'QUESTION RULES:',
    `- EXACTLY ${EXTRA_CANDIDATES_PER_TOPIC} questions PER TOPIC (${KNOWLEDGE_TOPICS.join(' / ')}), strongest-first;`,
    '  first topicTag = home topic. Cover breadth: each question should probe a DIFFERENT angle',
    '  (trend, ranking, mix-shift, funnel, cohort quality, concentration, anomaly surface).',
    '- categoryTags subset of ["explore","metric_explain","compare","diagnose"].',
    '- targetCatalogIds MUST be "cube.member" names copied EXACTLY from available_members.',
    '- Single-cube questions only (one cube\'s measures + dimensions per question).',
    '- Anchor time phrasing to data_coverage: stale cubes (>14 days behind today) get',
    '  period-neutral phrasing ("in the most recent month of data"), never "this week".',
    '',
    'METRIC RULES:',
    `- Up to ${METRICS_PER_TOPIC} metrics PER TOPIC: the measures a publisher should routinely watch for`,
    '  that topic, given what actually exists in available_members.',
    '- "member" MUST be a MEASURE name copied exactly from available_members (kind=measure).',
    '- "title" = short human label; "why" = one concrete line on what decisions it informs.',
    `- "topic" one of: ${KNOWLEDGE_TOPICS.join(' | ')}.`,
  ].join('\n');
}

export interface ParsedKnowledgeSet {
  questions: StarterQuestion[];
  metrics: Array<KnowledgeMetric & { topic: KnowledgeTopic }>;
}

/**
 * Parse the LLM object. Questions are validated via the caller-supplied
 * validator (parseAndValidateLlmSet bound to known members) — null means the
 * whole set is rejected. Metrics are filtered row-by-row against the measure
 * name set; invalid rows are dropped and reported in `droppedMetrics`.
 */
export function parseKnowledgeSet(
  raw: string,
  validateQuestions: (rawArray: string) => StarterQuestion[] | null,
  measureNames: Set<string>,
): (ParsedKnowledgeSet & { droppedMetrics: number }) | null {
  const unfenced = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    return null;
  }
  const obj = parsed as { questions?: unknown; metrics?: unknown };
  if (!Array.isArray(obj?.questions) || !Array.isArray(obj?.metrics)) return null;

  const questions = validateQuestions(JSON.stringify(obj.questions));
  if (!questions) return null;

  const topics = new Set<string>(KNOWLEDGE_TOPICS);
  const metrics: Array<KnowledgeMetric & { topic: KnowledgeTopic }> = [];
  let droppedMetrics = 0;
  for (const m of obj.metrics) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const x = m as any;
    const valid =
      typeof x?.member === 'string' &&
      measureNames.has(x.member) &&
      typeof x?.title === 'string' &&
      x.title.trim() &&
      typeof x?.why === 'string' &&
      x.why.trim() &&
      typeof x?.topic === 'string' &&
      topics.has(x.topic);
    if (!valid) {
      droppedMetrics += 1;
      continue;
    }
    metrics.push({
      member: x.member,
      title: x.title.trim(),
      why: x.why.trim(),
      topic: x.topic as KnowledgeTopic,
    });
  }
  return { questions, metrics, droppedMetrics };
}
