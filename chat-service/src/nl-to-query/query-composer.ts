/**
 * Assembles the partial Cube query from extracted slots. Anything missing
 * (no metric, no time range) is left blank — the clarification builder
 * decides whether to surface the gap as a question or let the LLM proceed.
 */

import type { CubeFilter, CubeQuery, TimeDimension } from '../types.js';
import type { DisambiguationSlots } from './types.js';

const DEFAULT_TIME_DIMENSION = 'time.event_date';

export interface ComposeInput {
  slots: DisambiguationSlots;
  knownMembers?: Set<string>;
  /**
   * Fallback time dimension Cube member id when the metric doesn't declare
   * one explicitly. Allows callers (eg. tests) to inject an override.
   */
  defaultTimeDimension?: string;
}

function isValidRef(ref: string | undefined, known?: Set<string>): boolean {
  if (!ref) return false;
  if (!known) return true;
  return known.has(ref);
}

export function composeQuery(input: ComposeInput): Partial<CubeQuery> {
  const { slots } = input;
  const out: Partial<CubeQuery> = {};

  if (isValidRef(slots.metric.value, input.knownMembers)) {
    out.measures = [slots.metric.value as string];
  }

  if (slots.dimension && isValidRef(slots.dimension.value, input.knownMembers)) {
    out.dimensions = [slots.dimension.value as string];
  }

  if (slots.timeRange?.value) {
    const td: TimeDimension = {
      dimension: input.defaultTimeDimension ?? DEFAULT_TIME_DIMENSION,
      dateRange: slots.timeRange.value,
    };
    if (slots.timeRange.granularity) {
      td.granularity = slots.timeRange.granularity as TimeDimension['granularity'];
    }
    out.timeDimensions = [td];
  }

  if (slots.filters?.length) {
    const filters: CubeFilter[] = slots.filters
      .filter((f) => isValidRef(f.member, input.knownMembers))
      .map((f) => ({
        member: f.member,
        operator: f.operator,
        values: f.values,
      }));
    if (filters.length) out.filters = filters;
  }

  // Leaderboard intent: rank rows of the per-entity dimension by the measure.
  // Only emit order+limit when BOTH metric and dimension resolved — otherwise
  // the clarification builder will collect the missing piece first.
  if (
    slots.intent?.value === 'leaderboard' &&
    out.measures &&
    out.measures.length > 0 &&
    out.dimensions &&
    out.dimensions.length > 0
  ) {
    out.order = { [out.measures[0]]: 'desc' };
    out.limit = slots.limit && slots.limit > 0 ? slots.limit : 10;
  }

  return out;
}

/**
 * Combine slot confidences into an overall score. We use the *minimum*
 * confidence across present slots so a single weak slot pulls the whole
 * resolution down — that's the signal the LLM needs to decide between
 * auto and clarify.
 */
export function overallConfidence(slots: DisambiguationSlots): number {
  // Metric is the anchor of every analytical query — always count its
  // confidence (including 0) so a missing metric pulls the overall down.
  // Time and dimension only count when actually present: aggressive mode
  // can default missing time to "last 7 days" without a confidence hit.
  const present: number[] = [slots.metric.confidence];

  if (slots.dimension?.value) present.push(slots.dimension.confidence);
  if (slots.timeRange?.value) present.push(slots.timeRange.confidence);
  if (slots.filters?.length) {
    for (const f of slots.filters) present.push(f.confidence);
  }
  if (slots.comparison?.value) present.push(slots.comparison.confidence);

  return present.reduce((a, b) => Math.min(a, b), 1);
}
