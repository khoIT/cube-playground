/**
 * Leaderboard-path query builder — phase 02a.
 *
 * When `intent='leaderboard'` AND the message resolves a concept with
 * `ranking` metadata (e.g. "spender"), this module assembles the CubeQuery
 * directly: rank by the concept's default measure, filter by its default
 * filter, group by the concept's entity primary key. No clarification step.
 *
 * Concepts without `ranking` (e.g. "active-user") are non-rankable — the
 * caller falls back to the aggregate path. Concepts with `ranking` but no
 * `entityCube`/`entityPk` are dimension concepts (e.g. "top-country") and
 * are also kicked back to the aggregate path; only entity-rank queries land
 * here.
 */

import type { CubeQuery, TimeDimension, CubeFilter } from '../types.js';
import type { OfficialTerm, ConceptFilter } from './types.js';

export interface LeaderboardTimeRange {
  dateRange?: string | [string, string];
  granularity?: TimeDimension['granularity'];
  /** Time dimension to use; falls back to a sensible per-cube default if absent. */
  dimension?: string;
}

export interface LeaderboardInput {
  concept: OfficialTerm;
  timeRange?: LeaderboardTimeRange;
  /** Optional explicit "top N" from the message (e.g. "top 5"). */
  limit?: number;
}

export interface LeaderboardResult {
  query: CubeQuery;
  /** True when the concept produced a complete entity-ranked query. */
  rankable: boolean;
  /** Why the concept didn't rank, when rankable=false. Used for telemetry. */
  reason?: string;
}

/**
 * Translate a concept's inline filter into a CubeFilter row. Op + value are
 * already constrained server-side (see glossary-validators) so this is a
 * straight projection — no further validation here.
 */
function conceptFilterToCubeFilter(f: ConceptFilter): CubeFilter {
  // Cube uses lowercase ops with `equals`/`notEquals` rather than `=`/`!=`.
  // Map to the closest Cube primitive; resolver-level == means equality.
  const opMap: Record<ConceptFilter['op'], string> = {
    '>': 'gt',
    '>=': 'gte',
    '<': 'lt',
    '<=': 'lte',
    '=': 'equals',
    '!=': 'notEquals',
    IN: 'equals',
    'NOT IN': 'notEquals',
  };
  const values = Array.isArray(f.value)
    ? f.value.map((v) => String(v))
    : [String(f.value)];
  return { member: f.member, operator: opMap[f.op], values };
}

/**
 * Build the leaderboard query. Returns `{rankable: false}` when the concept
 * lacks the metadata needed for an entity rank — caller falls back to the
 * existing aggregate path.
 */
export function buildLeaderboardQuery(input: LeaderboardInput): LeaderboardResult {
  const { concept, timeRange, limit } = input;

  if (!concept.ranking) {
    return { query: {}, rankable: false, reason: 'no ranking config on concept' };
  }
  if (!concept.entityCube || !concept.entityPk) {
    return { query: {}, rankable: false, reason: 'no entity on concept' };
  }
  if (!concept.defaultMeasureRef) {
    return { query: {}, rankable: false, reason: 'no default measure on concept' };
  }

  const measure = concept.defaultMeasureRef;
  const orderDir = concept.ranking.order === 'ASC' ? 'asc' : 'desc';
  const effectiveLimit = limit ?? concept.ranking.default_limit;

  const query: CubeQuery = {
    measures: [measure],
    dimensions: [concept.entityPk],
    order: { [measure]: orderDir },
    limit: effectiveLimit,
  };

  if (concept.defaultFilter) {
    query.filters = [conceptFilterToCubeFilter(concept.defaultFilter)];
  }

  if (timeRange?.dateRange) {
    // Default time dimension: `<entity_cube>.event_date` is the playground
    // convention; callers can override via `timeRange.dimension`.
    const dim = timeRange.dimension ?? `${concept.entityCube}.event_date`;
    const td: TimeDimension = { dimension: dim, dateRange: timeRange.dateRange };
    if (timeRange.granularity) td.granularity = timeRange.granularity;
    query.timeDimensions = [td];
  }

  return { query, rankable: true };
}
