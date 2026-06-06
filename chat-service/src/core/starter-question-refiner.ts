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

export const SEED_TOPICS = ['liveops', 'user_acquisition', 'monetization'] as const;
const TOPICS = new Set<string>(SEED_TOPICS);
const CATEGORIES = new Set(['explore', 'metric_explain', 'compare', 'diagnose']);

/** The frozen seed ships exactly this many questions per topic per game. */
export const QUESTIONS_PER_TOPIC = 6;
/**
 * Hard cap on question text length. The curated business-case list tops out
 * around ~95 chars; anything longer reads as compound analyst prose rather
 * than a clickable chip. Over-cap candidates are dropped row-by-row (length
 * is a style miss, not a hallucination signal — no wholesale reject).
 */
export const MAX_QUESTION_TEXT_CHARS = 100;

/**
 * Phrasing/content exemplars from the cube business case's curated question
 * list (Core Analytics & Reporting / Growth & UA / LiveOps & Activation).
 * They anchor BOTH the analytical shape (questions a publisher acts on) and
 * the style contract: short report-headline questions, one ask each.
 */
export const STYLE_EXEMPLARS: Record<(typeof SEED_TOPICS)[number], string[]> = {
  monetization: [
    'How many paying users do we have right now?',
    'Total revenue this month, split by IAP vs Web payment channel',
    'ARPPU broken down by payer tier (whale / dolphin / minnow)',
    'Revenue this month vs last month, per OS platform',
    'Per-user 7-day spend tier (high / mid / low) across the player base',
  ],
  user_acquisition: [
    'Top 5 acquisition channels by 30-day LTV',
    'Trailing 7-day revenue per acquisition channel vs the prior week',
    "What % of last month's install cohort recharged within 30 days?",
    'D1 / D7 / D30 retention for paid vs organic installs',
  ],
  liveops: [
    "Today's actives by register-month cohort — veterans vs new installs",
    "Whales who haven't recharged in 14 days, by media source",
    'New vs veteran players: daily playtime, matches, and mode mix',
    'DAU by country and payer tier over the last 30 days',
  ],
};
/**
 * The LLM is asked for extra candidates per topic so the end-to-end
 * verification pass (real chat turn → artifact) can discard duds and still
 * fill QUESTIONS_PER_TOPIC without an immediate retry round.
 */
export const CANDIDATES_PER_TOPIC = 8;

// ---------------------------------------------------------------------------
// Question depth — basic (cross-game KPI cubes) vs advanced (game-specific
// event/raw tables). For games that HAVE advanced cubes, each topic ships
// QUESTIONS_PER_TOPIC/2 of each so the list shows both classic publishing
// KPIs ("top spenders this week") and this-game-only insights (gacha pulls,
// tutorial funnels, match telemetry). Games without advanced cubes fall back
// to depth-agnostic quotas automatically.
// ---------------------------------------------------------------------------

export type QuestionDepth = 'basic' | 'advanced';

/**
 * Game-specific raw/event cubes. `(^|_)` tolerates prod's game-prefixed
 * physical names (cfm_etl_game_detail) alongside local bare names.
 */
const ADVANCED_CUBE_RE = /(^|_)etl_|(^|_)user_(devices|ips|roles)$/;

export function isAdvancedCube(cubeName: string): boolean {
  return ADVANCED_CUBE_RE.test(cubeName);
}

/** A question is advanced when ANY referenced member lives on an advanced cube. */
export function questionDepth(q: Pick<StarterQuestion, 'targetCatalogIds'>): QuestionDepth {
  return q.targetCatalogIds.some((ref) => isAdvancedCube(ref.split('.')[0]))
    ? 'advanced'
    : 'basic';
}

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
  // Depth split only applies when the schema actually has advanced cubes —
  // games modeled with the cross-game basics alone keep depth-agnostic rules.
  const hasAdvanced = projection.some((m) => isAdvancedCube(m.cube));
  const half = QUESTIONS_PER_TOPIC / 2;
  const candHalf = CANDIDATES_PER_TOPIC / 2;
  const depthRules = hasAdvanced
    ? [
        '- DEPTH MIX: this game has both standard KPI cubes and game-specific event tables.',
        `  Per topic, produce EXACTLY ${candHalf} BASIC candidates and ${candHalf} ADVANCED candidates;`,
        `  the verified best ${half} of each depth per topic ship.`,
        '    BASIC    = classic publishing KPIs over the cross-game cubes (recharge, mf_users,',
        '               active_daily, game_key_metrics, retention, user_recharge_daily…).',
        '               Style examples: "top spenders this week", "ARPPU broken down by payer',
        '               tier", "LTV by install cohort", "D1/D7 retention by channel".',
        '    ADVANCED = insights ONLY possible with this game\'s event-level tables (etl_*,',
        '               user_roles/user_devices/user_ips): game modes, maps, gacha pulls,',
        '               tutorial funnels, economy flows, match telemetry.',
        '  Tag each item "depth": "basic" | "advanced" accordingly (a question referencing ANY',
        '  etl_*/user_roles/devices/ips member counts as advanced).',
      ]
    : [];
  return [
    'You curate starter questions for a game-analytics chatbot used by a game PUBLISHING company.',
    'This list is the FIRST thing a stakeholder sees in a product demo — every question must be',
    'impressive: a concrete, game-specific analysis whose answer is a striking chart, ranking, or',
    'comparison. Generic dashboard questions ("how is DAU?") are weak; prefer questions that reveal',
    'something about THIS game (its modes, maps, payer tiers, channels, cohorts).',
    '',
    'available_members (the ONLY members that exist):',
    JSON.stringify(projection),
    '',
    'baseline_questions (deterministic candidates — pick/improve the strongest, drop the rest):',
    JSON.stringify(baseline),
    '',
    'style_exemplars (the phrasing baseline — adapt the SHAPE to this game\'s actual members):',
    JSON.stringify(STYLE_EXEMPLARS),
    '',
    'STYLE — every question must read like a report headline, exactly like style_exemplars:',
    `- SHORT: at most ${MAX_QUESTION_TEXT_CHARS} characters. Longer texts are dropped before verification.`,
    '- ONE ask per question. NEVER compound two-part phrasing ("…, and how has X shifted…").',
    '- Punchy noun-phrase or a single direct question; no scene-setting prose.',
    '',
    'RULES:',
    '- Output ONLY a JSON array. No prose, no code fences.',
    `- EXACTLY ${CANDIDATES_PER_TOPIC} candidate questions PER TOPIC (${CANDIDATES_PER_TOPIC * SEED_TOPICS.length} total),`,
    `  ordered strongest-first within each topic. Each question will be executed end-to-end against`,
    `  the live data model; only the verified best ${QUESTIONS_PER_TOPIC} per topic ship — so favour questions`,
    '  whose data CERTAINLY exists over speculative ones.',
    ...depthRules,
    '- Each item: {"id": string, "text": string, "topicTags": string[], "categoryTags": string[], "targetCatalogIds": string[]}.',
    '- topicTags: the FIRST tag is the question\'s home topic and drives the per-topic quota:',
    '    liveops          = engagement, activity patterns, game modes/maps, retention ops, win-back',
    '    user_acquisition = new users, install cohorts, early retention, channel/cohort quality',
    '    monetization     = revenue, payers, ARPU, VIP/whales, conversion to payer',
    '- categoryTags subset of ["explore","metric_explain","compare","diagnose"].',
    '- targetCatalogIds MUST be "cube.member" names copied EXACTLY from available_members. NEVER invent a name.',
    '- Keep each question answerable by ONE aggregate query over ONE cube\'s members (its measures +',
    '  dimensions): single-cube questions verify cleanly; cross-cube joins and multi-step cohort math',
    '  fail verification and waste a slot.',
    '- Prefer cubes with rich dimensions and fresh data coverage over sparse/stale ones.',
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
    // Style gate: over-length questions are compound analyst prose, not chips.
    if (x.text.trim().length > MAX_QUESTION_TEXT_CHARS) continue;
    if (!Array.isArray(x.topicTags) || x.topicTags.length === 0) continue;
    if (!x.topicTags.every((t: unknown) => typeof t === 'string' && TOPICS.has(t))) continue;
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
      topicTags: x.topicTags,
      categoryTags: x.categoryTags,
      targetCatalogIds: x.targetCatalogIds,
    });
  }
  return valid.length >= MIN_VALID_QUESTIONS ? valid : null;
}

/**
 * One-shot Agent-SDK call with no tools, same wiring as the title summariser.
 * Used by the pregenerate scripts only.
 *
 * Auth: inherits the LOCAL Claude Code subscription login — the gateway vars
 * are stripped so the SDK falls back to the dev machine's `claude` auth.
 * Seed generation is a batch dev-machine task; it must not burn the
 * quota-capped chat-service gateway key (which runtime turns depend on).
 */
export async function defaultCallLlm(prompt: string): Promise<string> {
  const { query: sdkQuery } = await import('@anthropic-ai/claude-agent-sdk');
  const env = { ...process.env } as Record<string, string>;
  delete env['ANTHROPIC_API_KEY'];
  delete env['ANTHROPIC_BASE_URL'];
  let result = '';
  for await (const msg of sdkQuery({
    prompt,
    options: {
      model: config.starterRefinerModel,
      env,
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
