/**
 * Prior-cube anchored metric resolution — last-chance fallback for the
 * disambiguation pipeline.
 *
 * When the glossary cannot resolve a metric phrase but session memory knows
 * which cube the conversation is anchored to (the cube behind the chart the
 * user is looking at), search THAT cube's measures with token-equivalence
 * scoring before surfacing a canned clarification. Session 3542a7c1: "user
 * count" after a `etl_game_detail.matches` chart must reach
 * `etl_game_detail.distinct_players`, which the glossary cannot see.
 *
 * Pure + LLM-free. The caller owns the trigger guards (follow-up-shaped
 * message, anchor present) and the confidence policy (auto-fill vs
 * clarify-options).
 */

import { searchMembers, type MemberMatch } from './member-resolution.js';

/** Candidates below this score are noise, not worth offering as options. */
const CANDIDATE_FLOOR = 0.5;
const MAX_CANDIDATES = 4;

/**
 * Time-grain phrases are granularity hints, not member-name tokens — "user
 * count per day" must score as "user count" or the noise tokens dilute the
 * coverage below the auto threshold. Search-side strip only; callers keep
 * the full residual for granularity handling.
 */
const TIME_GRAIN_NOISE_RE =
  /\b(?:per|by|theo|mỗi|hàng)\s+(?:day|week|month|year|hour|ngày|tuần|tháng|năm|giờ)\b|\b(?:daily|weekly|monthly|hourly|yearly)\b/giu;

function stripTimeGrainNoise(phrase: string): string {
  const stripped = phrase.replace(TIME_GRAIN_NOISE_RE, ' ').replace(/\s+/g, ' ').trim();
  return stripped.length > 0 ? stripped : phrase;
}

export interface AnchorCubeResolution {
  /** Ranked plausible measures on the anchor cube (all ≥ CANDIDATE_FLOOR). */
  candidates: MemberMatch[];
}

/**
 * Search the anchor cube's measures for the unresolved metric phrase.
 * Token-equivalence is ON here (and ONLY here) — "users ≈ players" is safe
 * within the cube the user is already charting, wrong as a global rule.
 */
export function resolveAgainstAnchorCube(
  phrase: string,
  anchorCube: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any,
): AnchorCubeResolution {
  if (!phrase.trim() || !anchorCube) return { candidates: [] };
  const matches = searchMembers(meta, stripTimeGrainNoise(phrase), MAX_CANDIDATES, {
    cube: anchorCube,
    measuresOnly: true,
    tokenEquiv: true,
  });
  return { candidates: matches.filter((m) => m.confidence >= CANDIDATE_FLOOR) };
}
