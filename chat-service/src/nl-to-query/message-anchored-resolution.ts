/**
 * Message-anchored resolution helpers.
 *
 * When the glossary/metric resolver comes up empty but a cube has been named —
 * either by the user in this message ("… using etl_money_flow") or by the
 * assistant in a prior {{field:cube.member}} prose suggestion it never charted
 * — resolve the remaining metric/dimension phrases against THAT cube instead of
 * falling back to a canned, often-irrelevant clarification menu. Naming a cube
 * is a strong, explicit signal; honour it.
 *
 * Pure + LLM-free. Operates on whatever /meta exposes, so it is portable across
 * prefix and game_id cube workspaces (no hardcoded cube names).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { searchMembers, type MemberMatch } from './member-resolution.js';
import { resolveMemberMeta, cubeNameOf } from '../core/cube-meta-capability.js';

/** Clarify menus stay short — offer the most relevant handful, not all. */
const MAX_ANCHOR_MEASURE_OPTIONS = 6;
/** Shortest cube/member leaf we trust as a whole-word mention (avoid "id" etc.). */
const MIN_NAME_LEN = 3;

/** Lowercase, separators (._-)→space, collapse whitespace. Mirrors member-resolution. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Member leaf only: "etl_money_flow.total_out" → "total_out". */
function leafOf(memberRef: string): string {
  return memberRef.includes('.') ? memberRef.slice(memberRef.lastIndexOf('.') + 1) : memberRef;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** All cube names present in /meta, longest first so multi-word names win. */
export function knownCubeNames(meta: any): string[] {
  const names = new Set<string>();
  for (const c of (meta?.cubes as any[]) ?? []) {
    if (typeof c?.name === 'string') names.add(c.name);
  }
  return [...names].sort((a, b) => b.length - a.length);
}

/**
 * First known cube named as a whole token in the message — matched against
 * both the raw underscored form ("etl_money_flow") and the space-normalised
 * form ("etl money flow"). Longest cube name wins, so "user_recharge_daily"
 * beats a substring like "recharge".
 */
export function firstNamedCube(message: string, cubeNames: string[]): string | null {
  if (!message) return null;
  const raw = message.toLowerCase();
  const spaced = norm(message);
  for (const cube of cubeNames) {
    if (cube.length < MIN_NAME_LEN) continue;
    const c = cube.toLowerCase();
    const underscored = new RegExp(`(?:^|[^a-z0-9_])${escapeRe(c)}(?:[^a-z0-9_]|$)`);
    if (underscored.test(raw)) return cube;
    const spacedName = norm(cube);
    const wordRe = new RegExp(`(?:^|[^a-z0-9])${escapeRe(spacedName)}(?:[^a-z0-9]|$)`);
    if (wordRe.test(spaced)) return cube;
  }
  return null;
}

function makeMatch(meta: any, member: string, cube: string, confidence: number): MemberMatch {
  const m = resolveMemberMeta(meta, member);
  return { member, cube, kind: m.kind, dataType: m.dataType, label: m.label, confidence, matchedOn: 'meta-name' };
}

/** Every measure on a cube, as clarify-ready options. Fallback when nothing scores. */
function listCubeMeasures(meta: any, cube: string, limit = MAX_ANCHOR_MEASURE_OPTIONS): MemberMatch[] {
  const out: MemberMatch[] = [];
  for (const c of (meta?.cubes as any[]) ?? []) {
    if (c?.name !== cube) continue;
    for (const m of c.measures ?? []) out.push(makeMatch(meta, m.name, cube, 0.5));
  }
  return out.slice(0, limit);
}

/**
 * Measures on the anchor cube, ranked by relevance to the residual phrase.
 * The metric clarify-option set when the user named the cube but the phrase
 * didn't cleanly resolve (e.g. an in-vs-out comparison the single metric slot
 * can't capture). No score floor — the explicit cube mention is the signal, so
 * we always surface the cube's own measures over a canned cross-cube menu.
 */
export function anchorCubeMeasureOptions(meta: any, cube: string, phrase: string): MemberMatch[] {
  const ranked = searchMembers(meta, phrase, MAX_ANCHOR_MEASURE_OPTIONS, {
    cube,
    measuresOnly: true,
    tokenEquiv: true,
  });
  return ranked.length > 0 ? ranked : listCubeMeasures(meta, cube);
}

/**
 * Find a dimension on the anchor cube whose name/title the message mentions
 * verbatim ("by money type" → `money_type`). Substring-with-word-boundaries —
 * deliberately conservative so a bare cube mention doesn't drag in an unrelated
 * dimension. Longest match wins ("money type" beats "money").
 */
export function findAnchorDimensionInMessage(
  message: string,
  cube: string,
  meta: any,
): MemberMatch | null {
  const msg = norm(message);
  if (!msg) return null;
  let best: { member: string; len: number } | null = null;
  for (const c of (meta?.cubes as any[]) ?? []) {
    if (c?.name !== cube) continue;
    for (const d of c.dimensions ?? []) {
      const candidates = [norm(leafOf(d.name)), norm(d.title ?? ''), norm(d.shortTitle ?? '')];
      for (const cand of candidates) {
        if (cand.length < MIN_NAME_LEN) continue;
        const wordRe = new RegExp(`(?:^|[^a-z0-9])${escapeRe(cand)}(?:[^a-z0-9]|$)`);
        if (wordRe.test(msg) && (!best || cand.length > best.len)) {
          best = { member: d.name, len: cand.length };
        }
      }
    }
  }
  return best ? makeMatch(meta, best.member, cube, 0.9) : null;
}

const SUGGESTED_FIELD_RE = /\{\{field:([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\}\}/gi;

/**
 * Extract `cube.member` refs the assistant embedded as {{field:…}} chips in its
 * reply. The last one is the most recent suggestion — what a "show me that"
 * follow-up most likely means.
 */
export function extractSuggestedFieldRefs(text: string): string[] {
  const out: string[] = [];
  if (!text) return out;
  SUGGESTED_FIELD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SUGGESTED_FIELD_RE.exec(text)) !== null) out.push(`${m[1]}.${m[2]}`);
  return out;
}

/** Cube of the assistant's most recent {{field:}} suggestion, or null. */
export function lastSuggestedCube(text: string): string | null {
  const refs = extractSuggestedFieldRefs(text);
  return refs.length ? cubeNameOf(refs[refs.length - 1]!) : null;
}
