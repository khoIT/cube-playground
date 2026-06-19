/**
 * Trust guard for recommended actions.
 *
 * The invariant: nothing reaches the model as an actionable recommendation
 * unless it carries a verifiable citation — a source engine, a triggering
 * signal, and a benchmark FIELD. The benchmark may be null (an honest "no
 * benchmark available yet"); what is forbidden is the field being absent, which
 * would mean the citation was never built. This runs on the server-truthed
 * citation payload, not on model prose, so the model cannot talk an uncited
 * action past the check.
 *
 * Blind-spot items (structurally unmeasurable, e.g. competitive-integrity
 * cheating) are never actionable: if one is attached to a candidate it is
 * rejected and re-surfaced as a caveat ("cannot assess — no data path").
 */

import type { ActionCitation } from './recommendation-citation.js';

export interface GuardableCandidate {
  id: string;
  citation?: ActionCitation;
}

export interface TrustGuardResult<T> {
  /** Candidates that carry a complete citation and are safe to render. */
  valid: T[];
  /** Dropped candidates with the reason — never silently discarded. */
  rejected: Array<{ id: string; reason: string }>;
  /** Honest narrative caveats: blind spots + a note when anything was withheld. */
  caveats: string[];
}

/**
 * A citation is complete when it names a non-empty source engine and triggering
 * signal and carries the `benchmark` key (null permitted — "no benchmark yet").
 */
export function isCited(citation: ActionCitation | undefined): citation is ActionCitation {
  return (
    !!citation &&
    typeof citation.sourceEngine === 'string' &&
    citation.sourceEngine.length > 0 &&
    typeof citation.triggeringSignal === 'string' &&
    citation.triggeringSignal.trim().length > 0 &&
    'benchmark' in citation
  );
}

/**
 * Partition candidates into renderable (fully cited, non-blind-spot) and
 * rejected, and assemble the honest caveats the narrative must include.
 */
export function guardRecommendations<T extends GuardableCandidate>(
  candidates: T[],
  blindSpots: Array<{ id: string; lever: string; signal: string }> = [],
): TrustGuardResult<T> {
  const valid: T[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];

  for (const c of candidates) {
    if (c.citation?.blindSpot) {
      rejected.push({ id: c.id, reason: 'blind spot — structurally unmeasurable, not an actionable recommendation' });
      continue;
    }
    if (!isCited(c.citation)) {
      rejected.push({ id: c.id, reason: 'missing citation (sourceEngine / triggeringSignal / benchmark)' });
      continue;
    }
    valid.push(c);
  }

  const caveats: string[] = [];
  for (const b of blindSpots) {
    caveats.push(`Cannot assess: ${b.lever} — ${b.signal} (no data path; surfaced, never recommended).`);
  }
  if (rejected.length > 0) {
    caveats.push(`${rejected.length} candidate(s) withheld for failing the citation/trust check.`);
  }

  return { valid, rejected, caveats };
}
