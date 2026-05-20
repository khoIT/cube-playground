/**
 * Server-side card-runner. For a refreshed segment, composes a Cube query
 * per preset KPI / card spec, executes against /load, and returns the
 * normalised rows ready for the FE to render synchronously.
 *
 * Queries are scoped by identity-IN filter against the segment's uid_list,
 * mirroring the FE useSegmentCubeQuery hook.
 */

import { createHash } from 'node:crypto';
import { load } from './cube-client.js';
import type {
  PresetSpec,
  KpiSpec,
  CardSpec,
} from '../presets/mf-users-hub.js';

interface CubeQuery {
  measures: string[];
  dimensions?: string[];
  timeDimensions?: Array<{
    dimension: string;
    granularity?: string;
    dateRange?: string;
  }>;
  order?: Record<string, 'asc' | 'desc'>;
  filters?: Array<{
    member: string;
    operator: string;
    values?: string[];
  }>;
  limit?: number;
}

export interface CardCacheEntry {
  cardId: string;
  queryHash: string;
  rows: Array<Record<string, unknown>>;
}

function queryForKpi(spec: KpiSpec): CubeQuery {
  const q: CubeQuery = { measures: [spec.measure] };
  if (spec.timeDimension && spec.dateRange) {
    q.timeDimensions = [{ dimension: spec.timeDimension, dateRange: spec.dateRange }];
  }
  return q;
}

function queryForCard(spec: CardSpec): CubeQuery {
  if (spec.kind === 'line') {
    return {
      measures: [spec.measure],
      timeDimensions: [
        {
          dimension: spec.timeDimension,
          granularity: spec.granularity ?? 'day',
          dateRange: spec.dateRange ?? 'last 14 days',
        },
      ],
    };
  }
  // bar + composition share the same query shape
  return {
    measures: [spec.measure],
    dimensions: [spec.groupBy],
    order: { [spec.measure]: 'desc' },
    limit: spec.limit ?? 6,
  };
}

function scopeQuery(q: CubeQuery, identityDim: string, uids: string[]): CubeQuery {
  if (uids.length === 0) return q;
  const next: CubeQuery = { ...q };
  next.filters = [
    ...(q.filters ?? []),
    { member: identityDim, operator: 'equals', values: uids },
  ];
  return next;
}

function hashQuery(q: CubeQuery): string {
  return createHash('sha256').update(JSON.stringify(q)).digest('hex').slice(0, 16);
}

function extractRows(loadResult: unknown): Array<Record<string, unknown>> {
  const r = loadResult as {
    data?: Array<Record<string, unknown>>;
    results?: Array<{ data?: Array<Record<string, unknown>> }>;
  };
  return r.data ?? r.results?.[0]?.data ?? [];
}

/** Walk a preset and emit { cardId, queryHash, rows } per KPI + card. */
export async function runPresetCards(
  preset: PresetSpec,
  uids: string[],
): Promise<CardCacheEntry[]> {
  const allSpecs: Array<{ id: string; query: CubeQuery }> = [];

  for (const kpi of preset.headlineKpis) {
    allSpecs.push({ id: `kpi:${kpi.id}`, query: queryForKpi(kpi) });
  }
  for (const tab of preset.tabs) {
    for (const kpi of tab.kpis) {
      allSpecs.push({ id: `kpi:${tab.id}:${kpi.id}`, query: queryForKpi(kpi) });
    }
    for (const card of tab.cards) {
      allSpecs.push({ id: `card:${tab.id}:${card.id}`, query: queryForCard(card) });
    }
  }

  const results: CardCacheEntry[] = [];
  for (const { id, query } of allSpecs) {
    const scoped = scopeQuery(query, preset.identityDim, uids);
    try {
      const raw = await load(scoped);
      results.push({ cardId: id, queryHash: hashQuery(scoped), rows: extractRows(raw) });
    } catch (err) {
      // Card-level failure shouldn't kill the whole refresh — log and skip.
      // The FE will fall back to live fetch for any cardId missing from cache.
      console.warn(`[card-runner] ${id} failed:`, (err as Error).message);
    }
  }
  return results;
}
