/**
 * Pure function — produces three follow-up chip suggestions for a finished
 * assistant turn. Inputs come from the assistant message tail (tool names
 * fired, cubes referenced via query_artifact rows).
 *
 * Picks at most one entry per matched rule before falling back to the
 * generic starter pool so repeated turns rotate through different chips.
 */

import {
  FOLLOWUP_FALLBACK,
  FOLLOWUP_RULES,
  type FollowupRule,
} from './followup-rules';

export interface FollowupContext {
  /** Cube names touched by the turn (from query_artifact source refs). */
  cubes: ReadonlyArray<string>;
  /** Tool names invoked by the turn. */
  tools: ReadonlyArray<string>;
  /** Already-shown chip texts (suppressed to avoid duplicates). */
  suppress?: ReadonlyArray<string>;
}

export interface FollowupChip {
  id: string;
  text: string;
  /** Which rule produced this chip (or `fallback`). */
  derivedFrom: string;
}

const MAX_CHIPS = 3;

function ruleFires(rule: FollowupRule, ctx: FollowupContext): boolean {
  if (rule.cubeAny && rule.cubeAny.length > 0) {
    if (ctx.cubes.some((c) => rule.cubeAny!.some((needle) => c.toLowerCase().includes(needle)))) {
      return true;
    }
  }
  if (rule.toolAny && rule.toolAny.length > 0) {
    if (ctx.tools.some((t) => rule.toolAny!.includes(t))) return true;
  }
  return false;
}

export function suggestFollowups(ctx: FollowupContext): FollowupChip[] {
  const suppress = new Set((ctx.suppress ?? []).map((s) => s.toLowerCase()));
  const seen = new Set<string>();
  const chips: FollowupChip[] = [];

  for (const rule of FOLLOWUP_RULES) {
    if (chips.length >= MAX_CHIPS) break;
    if (!ruleFires(rule, ctx)) continue;
    for (const text of rule.suggestions) {
      const key = text.toLowerCase();
      if (seen.has(key) || suppress.has(key)) continue;
      seen.add(key);
      chips.push({ id: `${rule.id}:${chips.length}`, text, derivedFrom: rule.id });
      break; // one chip per rule keeps variety high
    }
  }

  if (chips.length < MAX_CHIPS) {
    for (const text of FOLLOWUP_FALLBACK) {
      if (chips.length >= MAX_CHIPS) break;
      const key = text.toLowerCase();
      if (seen.has(key) || suppress.has(key)) continue;
      seen.add(key);
      chips.push({ id: `fallback:${chips.length}`, text, derivedFrom: 'fallback' });
    }
  }

  return chips.slice(0, MAX_CHIPS);
}
