/**
 * Starter-question pass-through for `disambiguate_query`.
 *
 * Pregenerated starter questions (runtime/seed/starter-questions-seed.json)
 * are frozen text with meta-validated `targetCatalogIds` — so when the user
 * clicks one, the intended cube members are ALREADY KNOWN. Matching the
 * incoming message against the seed by exact (normalised) text lets the tool
 * skip glossary resolution entirely and return action='auto' with the members
 * pinned, instead of e.g. offering a canned revenue clarification for an
 * engagement question the glossary can't see (session 24df367b).
 *
 * Falls through (returns null) whenever anything is off — no seed, no text
 * match, any member missing from THIS workspace's meta (prod-prefixed cube
 * names), or no measure among the targets — so the normal pipeline keeps
 * full ownership of every non-chip message.
 */

import { getSeedEntry } from '../db/starter-questions-seed.js';
import { resolveMemberMeta } from '../core/cube-meta-capability.js';
import type { CubeQuery } from '../types.js';

export interface StarterPassthroughHit {
  questionId: string;
  query: CubeQuery;
  /** Pinned measure refs — the first one doubles as the metric slot value. */
  measures: string[];
  dimensions: string[];
}

/** Collapse whitespace + case so chip text survives copy/paste mangling. */
function normalise(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** First time dimension of a cube, from /meta. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function timeDimensionOf(meta: any, cubeName: string): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cube = (meta?.cubes ?? []).find((c: any) => c.name === cubeName);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const td = (cube?.dimensions ?? []).find((d: any) => d.type === 'time');
  return td?.name ?? null;
}

export function matchStarterQuestion(
  message: string,
  gameId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any,
  knownMembers: Set<string> | undefined,
): StarterPassthroughHit | null {
  if (!meta || !knownMembers) return null;
  const seed = getSeedEntry(gameId);
  if (!seed) return null;

  const wanted = normalise(message);
  const question = seed.entry.questions.find((q) => normalise(q.text) === wanted);
  if (!question) return null;

  // Every target member must exist in THIS workspace's meta. The seed was
  // generated against one workspace's member names; a layout mismatch
  // (e.g. prod prefix-named cubes) must fall through to normal resolution,
  // never produce a query Cube would reject.
  if (!question.targetCatalogIds.every((ref) => knownMembers.has(ref))) return null;

  const measures: string[] = [];
  const dimensions: string[] = [];
  for (const ref of question.targetCatalogIds) {
    const kind = resolveMemberMeta(meta, ref).kind;
    if (kind === 'measure') measures.push(ref);
    else if (kind === 'dimension') dimensions.push(ref);
    // timeDimension targets are skipped — the time bound is added below.
  }
  if (measures.length === 0) return null;

  const query: CubeQuery = {
    measures,
    ...(dimensions.length > 0 ? { dimensions } : {}),
    // "drive the most X" chips want a ranking — order by the primary measure.
    order: { [measures[0]]: 'desc' },
    limit: 50,
  };

  // Bound the time axis so behavior cubes with a ≤31-day guard accept the
  // query first try. The agent re-anchors via get_time_coverage if this
  // window turns out to be ahead of the data.
  const cubeName = measures[0].split('.')[0];
  const timeDim = timeDimensionOf(meta, cubeName);
  if (timeDim) {
    query.timeDimensions = [{ dimension: timeDim, dateRange: 'last 30 days' }];
  }

  return { questionId: question.id, query, measures, dimensions };
}
