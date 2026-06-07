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
import type { StarterQuestion } from '../db/starter-questions-store.js';
import type { CubeQuery } from '../types.js';
import type { DisambiguationResult } from '../nl-to-query/index.js';

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

/**
 * Pick the cube's time dimension for bounding. Partitioned behavior cubes
 * guard on their partition column specifically — "Query … must bound
 * log_date/dteventtime within 31 days" — so when a cube has several time
 * dimensions (etl_register: register_time + log_date), the partition column
 * must win or the bounded query still 500s. Date-grain dims (recharge_date,
 * report_date) beat raw-timestamp dims (recharge_time) for the same reason —
 * pre-agg partitions key on the date column, so a *_time query 400s with
 * "No pre-aggregation partitions were built". Otherwise: first time dimension.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function timeDimensionOf(meta: any, cubeName: string): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cube = (meta?.cubes ?? []).find((c: any) => c.name === cubeName);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tds = (cube?.dimensions ?? []).filter((d: any) => d.type === 'time');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const partition = tds.find((d: any) => /\.(log_date|dteventtime)$/.test(d.name))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ?? tds.find((d: any) => /_date$/.test(d.name));
  return (partition ?? tds[0])?.name ?? null;
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

  return buildStarterQuery(question, seed.entry.coverage ?? {}, meta, knownMembers);
}

/**
 * Compose the pinned Cube query for one starter question — pure (no seed
 * lookup), so the pregenerate verification workflow can gate CANDIDATE
 * questions through the exact same query the clicked chip will run.
 * Null = not composable in this workspace (missing member / no measure).
 */
export function buildStarterQuery(
  question: StarterQuestion,
  coverage: Record<string, string>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any,
  knownMembers: Set<string>,
): StarterPassthroughHit | null {
  // Every target member must exist in THIS workspace's meta. The seed was
  // generated against one workspace's member names; a layout mismatch
  // (e.g. prod prefix-named cubes) must fall through to normal resolution,
  // never produce a query Cube would reject.
  if (!question.targetCatalogIds.every((ref) => knownMembers.has(ref))) return null;

  const measures: string[] = [];
  const dimensions: string[] = [];
  // A time-dimension TARGET signals the question wants a time AXIS (trend /
  // per-day series), not just a bound window — composed below as granularity.
  let wantsTimeAxis = false;
  for (const ref of question.targetCatalogIds) {
    const kind = resolveMemberMeta(meta, ref).kind;
    if (kind === 'measure') measures.push(ref);
    else if (kind === 'dimension') dimensions.push(ref);
    else if (kind === 'timeDimension') wantsTimeAxis = true;
  }
  if (measures.length === 0) return null;

  const cubeName = measures[0].split('.')[0];
  const timeDim = timeDimensionOf(meta, cubeName);

  const query: CubeQuery = {
    measures,
    ...(dimensions.length > 0 ? { dimensions } : {}),
    // "drive the most X" chips want a ranking — order by the primary measure.
    // Time-axis chips are a series instead: chronological order, and a limit
    // big enough that 30 days × dimension cardinality is never truncated
    // (measure-desc + limit 50 would drop random middle days of the series).
    order: wantsTimeAxis && timeDim ? { [timeDim]: 'asc' } : { [measures[0]]: 'desc' },
    limit: wantsTimeAxis ? 1000 : 50,
  };

  // Bound the time axis so behavior cubes with a ≤31-day guard accept the
  // query first try. When the seed carries a probed coverage date for this
  // time dimension, anchor the 30-day window to it — data pipelines lag
  // behind "today", so an unanchored "last 30 days" can land entirely ahead
  // of the data and return an empty (unimpressive) first preview. Without
  // coverage, fall back to a relative window; the agent re-anchors via
  // get_time_coverage if that turns out empty.
  if (timeDim) {
    const latest = coverage[timeDim];
    query.timeDimensions = [
      {
        dimension: timeDim,
        dateRange: latest ? [daysBefore(latest, 29), latest] : 'last 30 days',
        // Day granularity turns the bound window into a series — without it a
        // "trend over N days" chip collapses to one aggregate row, which
        // charts as a single bar and gives the user nothing to slice.
        ...(wantsTimeAxis ? { granularity: 'day' as const } : {}),
      },
    ];
  }

  return { questionId: question.id, query, measures, dimensions };
}

/** ISO date `days` before `isoDate` (UTC arithmetic — dates only, no clock). */
function daysBefore(isoDate: string, days: number): string {
  const t = new Date(`${isoDate}T00:00:00Z`).getTime() - days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Shape a starter hit as a DisambiguationResult so the standard memory writer
 * (`writeMemoryFromResult`) can persist the pinned slots. Without this trail
 * a follow-up turn ("add in user count", "break it down by mode") resolves
 * context-blind: session memory holds nothing, the Conversation-focus block
 * renders only the artifact UUID, and the resolver falls back to a canned
 * glossary clarification unrelated to the on-screen chart.
 */
export function starterHitToResult(
  hit: StarterPassthroughHit,
  message: string,
): DisambiguationResult {
  const td = hit.query.timeDimensions?.[0];
  return {
    query: hit.query,
    slots: {
      metric: { value: hit.measures[0], confidence: 1, alias: message },
      // A granularity axis means the chip charts a series — remember the
      // trend shape so slot-reply follow-ups keep charting a series.
      intent: { value: td?.granularity ? 'trend' : 'aggregate', confidence: 1 },
      ...(hit.dimensions[0]
        ? { dimension: { value: hit.dimensions[0], confidence: 1 } }
        : {}),
      ...(td?.dateRange
        ? { timeRange: { value: td.dateRange, confidence: 1, granularity: td.granularity } }
        : {}),
    },
    unresolved: [],
    clarifications: [],
    overallConfidence: 1,
    language: 'en',
    action: 'auto',
    warnings: [],
  };
}
