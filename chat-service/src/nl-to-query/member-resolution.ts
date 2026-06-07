/**
 * Natural-language → physical Cube member resolver for the chat agent.
 *
 * The agent used to hand-grep the full /meta blob to find member names
 * (`uid`→`user_id`, `time.event_date`→`recharge.recharge_date`), burning the
 * whole turn budget on trial-and-error. This module layers the existing
 * glossary resolver (business metrics/concepts) over a live-/meta fuzzy search
 * (structural dimensions, time dimensions, raw measures), then classifies each
 * candidate via `resolveMemberMeta`, returning ranked physical members.
 *
 * Pure + LLM-free. Operates on whatever members the live meta exposes, so it is
 * portable across prefix and game_id cube workspaces (no hardcoded cube names).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { OfficialTerm } from './types.js';
import { resolveTerms, findExactMatch, memberOrNull } from './synonym-resolver.js';
import {
  resolveMemberMeta,
  cubeNameOf,
  type MemberKind,
  type MemberDataType,
} from '../core/cube-meta-capability.js';

export type MatchedOn = 'glossary-exact' | 'glossary-alias' | 'meta-name' | 'meta-title';

export interface MemberMatch {
  /** Physical Cube member ref, e.g. "mf_users.user_id". */
  member: string;
  /** Owning cube name, e.g. "mf_users" (null for dot-less refs). */
  cube: string | null;
  kind: MemberKind;
  dataType: MemberDataType;
  /** Display label from /meta (shortTitle/title) or humanised member leaf. */
  label: string;
  /** 0..1 — higher is a stronger match. */
  confidence: number;
  matchedOn: MatchedOn;
}

export interface TermResolution {
  term: string;
  matches: MemberMatch[];
}

const DEFAULT_TOP_K = 3;

/** Lowercase, replace separators (._-) with spaces, collapse whitespace. */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  return normalise(s).split(' ').filter(Boolean);
}

/** Member leaf only: "mf_users.user_id" → "user_id". */
function leafOf(memberRef: string): string {
  return memberRef.includes('.') ? memberRef.slice(memberRef.lastIndexOf('.') + 1) : memberRef;
}

interface MetaMember {
  name: string;
  title?: string;
  shortTitle?: string;
  isMeasure?: boolean;
}

/** Flatten every measure + dimension across all cubes into a single list. */
function allMembers(meta: any): MetaMember[] {
  const out: MetaMember[] = [];
  for (const cube of (meta?.cubes as any[]) ?? []) {
    for (const m of cube.measures ?? []) out.push({ name: m.name, title: m.title, shortTitle: m.shortTitle, isMeasure: true });
    for (const d of cube.dimensions ?? []) out.push({ name: d.name, title: d.title, shortTitle: d.shortTitle });
  }
  return out;
}

/**
 * Token-equivalence classes for ANCHOR-SCOPED search only. Bridges the
 * vocabulary gap between how analysts phrase a metric and how cube members
 * are named ("user count" vs `distinct_players` — zero raw token overlap).
 * Deliberately tiny and curated; extend only on observed misses. NEVER apply
 * to global resolution — "users ≈ players" is wrong for account-level cubes.
 */
const TOKEN_EQUIV: Record<string, string> = {
  user: 'player', users: 'player', gamer: 'player', gamers: 'player',
  count: 'distinct', number: 'distinct', unique: 'distinct', num: 'distinct',
};

/** Canonicalise one token: equivalence class first, then naive plural stem. */
function canonicalToken(t: string): string {
  const mapped = TOKEN_EQUIV[t] ?? t;
  return mapped.length > 3 && mapped.endsWith('s') ? mapped.slice(0, -1) : mapped;
}

function canonicalSet(ts: Iterable<string>): Set<string> {
  return new Set([...ts].map(canonicalToken));
}

/**
 * Score a single meta member against a normalised query term.
 * Returns {score, matchedOn} or null when there is no meaningful overlap.
 * Scoring favours exact leaf/title equality, then full-token coverage, then
 * substring, then partial token overlap — so a confident name match outranks a
 * loose title brush.
 */
function scoreMember(
  member: MetaMember,
  termNorm: string,
  termTokens: string[],
  tokenEquiv = false,
): { score: number; matchedOn: MatchedOn } | null {
  if (!termNorm) return null;

  const leaf = normalise(leafOf(member.name));
  const title = normalise(member.title ?? '');
  const shortTitle = normalise(member.shortTitle ?? '');

  // Exact equality on the member leaf or a title — the strongest signal.
  if (leaf === termNorm) return { score: 0.97, matchedOn: 'meta-name' };
  if (title === termNorm || shortTitle === termNorm) return { score: 0.95, matchedOn: 'meta-title' };

  // With tokenEquiv, both sides pass through the equivalence classes so
  // "user count" can reach `distinct_players` (user→player, count→distinct).
  const canon = tokenEquiv ? canonicalToken : (t: string) => t;
  const qTokens = termTokens.map(canon);
  const leafTokens = tokenEquiv ? canonicalSet(tokens(member.name)) : new Set(tokens(member.name));
  const rawTitleTokens = [...tokens(member.title ?? ''), ...tokens(member.shortTitle ?? '')];
  const titleTokens = tokenEquiv ? canonicalSet(rawTitleTokens) : new Set(rawTitleTokens);

  // Every query token present in the leaf tokens → strong name match.
  if (qTokens.length > 0 && qTokens.every((t) => leafTokens.has(t))) {
    return { score: 0.88, matchedOn: 'meta-name' };
  }
  // Every query token present in the title tokens → strong title match.
  if (qTokens.length > 0 && qTokens.every((t) => titleTokens.has(t))) {
    return { score: 0.82, matchedOn: 'meta-title' };
  }

  // Substring of the leaf or title.
  if (leaf.includes(termNorm)) return { score: 0.7, matchedOn: 'meta-name' };
  if (title.includes(termNorm) || shortTitle.includes(termNorm)) return { score: 0.66, matchedOn: 'meta-title' };

  // Partial token overlap — weak, scaled by coverage.
  if (qTokens.length > 0) {
    const hit = qTokens.filter((t) => leafTokens.has(t) || titleTokens.has(t)).length;
    if (hit > 0) {
      const coverage = hit / qTokens.length;
      const onName = qTokens.some((t) => leafTokens.has(t));
      return { score: 0.4 + 0.2 * coverage, matchedOn: onName ? 'meta-name' : 'meta-title' };
    }
  }
  return null;
}

export interface SearchMembersOpts {
  /** Restrict matches to one cube's members (anchor-scoped resolution). */
  cube?: string;
  /** Restrict matches to measures (metric-slot fallback). */
  measuresOnly?: boolean;
  /** Apply the token-equivalence classes. Anchor-scoped callers only. */
  tokenEquiv?: boolean;
}

/** Fuzzy-search live /meta members for a term. Ranked desc, capped to `limit`. */
export function searchMembers(
  meta: any,
  term: string,
  limit = DEFAULT_TOP_K,
  opts: SearchMembersOpts = {},
): MemberMatch[] {
  const termNorm = normalise(term);
  const termTokens = tokens(term);
  const scored: MemberMatch[] = [];

  for (const m of allMembers(meta)) {
    if (opts.cube && cubeNameOf(m.name) !== opts.cube) continue;
    if (opts.measuresOnly && !m.isMeasure) continue;
    const s = scoreMember(m, termNorm, termTokens, opts.tokenEquiv ?? false);
    if (!s) continue;
    const meta2 = resolveMemberMeta(meta, m.name);
    scored.push({
      member: m.name,
      cube: cubeNameOf(m.name),
      kind: meta2.kind,
      dataType: meta2.dataType,
      label: meta2.label,
      confidence: s.score,
      matchedOn: s.matchedOn,
    });
  }

  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, limit);
}

/** Build a MemberMatch for a glossary-derived cube ref (classified via meta). */
function glossaryMatch(
  meta: any,
  ref: string,
  confidence: number,
  matchedOn: MatchedOn,
): MemberMatch {
  const m = resolveMemberMeta(meta, ref);
  return {
    member: ref,
    cube: cubeNameOf(ref),
    kind: m.kind,
    dataType: m.dataType,
    label: m.label,
    confidence,
    matchedOn,
  };
}

/**
 * Resolve one term: glossary (business metric/concept) ∪ live-meta fuzzy
 * search, deduped by member, ranked, top-K. Glossary exact > glossary alias >
 * strong meta match.
 */
export function resolveTerm(
  term: string,
  glossary: OfficialTerm[],
  meta: any,
  topK = DEFAULT_TOP_K,
): MemberMatch[] {
  const byMember = new Map<string, MemberMatch>();
  const add = (m: MemberMatch) => {
    const prev = byMember.get(m.member);
    if (!prev || m.confidence > prev.confidence) byMember.set(m.member, m);
  };

  // 1. Glossary exact match (whole term equals a term id/label/alias).
  const exact = findExactMatch(term, glossary);
  if (exact) {
    const t = exact.term;
    const ref = t.measureRef ?? memberOrNull(t.primaryCatalogId);
    if (ref) add(glossaryMatch(meta, ref, 1, 'glossary-exact'));
  }

  // 2. Glossary alias hits inside the term phrase.
  for (const hit of resolveTerms(term, glossary)) {
    if (hit.cubeRef) add(glossaryMatch(meta, hit.cubeRef, 0.9, 'glossary-alias'));
  }

  // 3. Live-meta fuzzy search for structural members the glossary doesn't hold.
  for (const m of searchMembers(meta, term, topK)) add(m);

  return Array.from(byMember.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, topK);
}

/** Resolve a batch of terms in one pass. Never throws; unknown terms → []. */
export function resolveQueryTerms(
  terms: string[],
  glossary: OfficialTerm[],
  meta: any,
  topK = DEFAULT_TOP_K,
): TermResolution[] {
  return terms.map((term) => ({ term, matches: resolveTerm(term, glossary, meta, topK) }));
}
