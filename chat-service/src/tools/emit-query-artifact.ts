/**
 * Tool: emit_query_artifact
 *
 * The LLM calls this tool when it wants to surface a clickable Cube query card.
 * Handler:
 *   1. Validates all measures/dimensions/timeDimension.dimension against /meta cache.
 *   2. Builds the deeplink URL (inline or session-storage path).
 *   3. Emits a 'query_artifact' SSE event via ctx.sseEmitter (side-effect).
 *   4. Returns { ok: true, id, deeplinkUrl } or { ok: false, error, detail }.
 *
 * The LLM never constructs the deeplinkUrl itself — this tool always builds it.
 */

import { z } from 'zod';
import * as cubeMetaCache from '../core/cube-meta-cache.js';
import { cubeHasTimeDimension, cubeNameOf, resolveMemberMeta } from '../core/cube-meta-capability.js';
import { getResolutions, mergeResolution } from '../cache/disambig-memory-adapter.js';
import type { DisambigResolutions, TimeRangeValue } from '../cache/disambig-memory-adapter.js';
import { config } from '../config.js';
import { buildChatDeeplink } from '../utils/build-chat-deeplink.js';
import { CubeQuerySchema } from './preview-cube-query.js';
import { normalizeCubeDateRanges } from './normalize-cube-date-range.js';
import {
  ChartSpecSchema,
  buildChartArtifact,
  MAX_ROWS,
} from '../services/chart-spec.js';
import { loadCubeRowsCovered } from '../services/load-cube-rows.js';
import { deriveChartSpec } from '../services/derive-chart-spec.js';
import type { ToolContext, QueryArtifact } from '../types.js';

export const name = 'emit_query_artifact';
export const description =
  'Emit a clickable query artifact card for the user. ' +
  'Provide a precise title, a one-sentence summary, the validated Cube query, ' +
  'and the source type. This tool validates members against /meta before emitting.';

export const inputSchema = {
  title: z.string().min(1).describe('Short descriptive title for the artifact card'),
  summary: z.string().min(1).describe('One-sentence plain-English description of what the query shows'),
  query: CubeQuerySchema,
  source: z.enum(['business-metric', 'segment', 'raw']),
  sourceRef: z
    .object({
      id: z.string(),
      name: z.string().optional(),
    })
    .optional(),
  chart: ChartSpecSchema.optional().describe(
    'Inline chart visualising this query. Strongly prefer attaching it here ' +
      '(not a separate emit_chart call) whenever the result is chartable: pick the ' +
      'type from the data shape (time series → line/multi-line, one category → bar, ' +
      'part-of-whole → stacked-bar/pie). If omitted, the server derives a basic ' +
      'chart from the query shape, but an explicit, well-typed chart is better.',
  ),
};

interface OkResult {
  ok: true;
  id: string;
  deeplinkUrl: string;
}

type ErrorResult =
  | {
      ok: false;
      error: 'unknown_member';
      detail: { which: 'measure' | 'dimension'; value: string };
    }
  | {
      ok: false;
      error: 'time_dim_required';
      detail: {
        measure: string;
        cubeName: string;
        sessionTimeRange: unknown;
        hint: string;
      };
    };

export async function handler(
  args: {
    title: string;
    summary: string;
    query: z.infer<typeof CubeQuerySchema>;
    source: 'business-metric' | 'segment' | 'raw';
    sourceRef?: { id: string; name?: string };
    chart?: z.infer<typeof ChartSpecSchema>;
  },
  ctx: ToolContext,
): Promise<OkResult | ErrorResult> {
  // 1. Fetch and validate members against /meta
  const meta = await cubeMetaCache.getMeta(ctx.gameId, ctx.workspace);
  const knownMembers = cubeMetaCache.extractMemberNames(meta);

  // Validate measures
  for (const measure of args.query.measures ?? []) {
    if (!knownMembers.has(measure)) {
      return { ok: false, error: 'unknown_member', detail: { which: 'measure', value: measure } };
    }
  }

  // Validate dimensions
  for (const dim of args.query.dimensions ?? []) {
    if (!knownMembers.has(dim)) {
      return { ok: false, error: 'unknown_member', detail: { which: 'dimension', value: dim } };
    }
  }

  // Validate timeDimension.dimension fields
  for (const td of args.query.timeDimensions ?? []) {
    if (!knownMembers.has(td.dimension)) {
      return {
        ok: false,
        error: 'unknown_member',
        detail: { which: 'dimension', value: td.dimension },
      };
    }
  }

  // Refuse to emit a snapshot-cube measure when the user's session memory
  // says they care about a time range. The model sometimes drops the
  // timeRange to escape a Cube error rather than asking — produces a wrong
  // lifetime aggregate. Force the model back to the clarification path.
  const sessionTimeRange = ctx.db ? getResolutions(ctx.db, ctx.sessionId).timeRange : undefined;
  if (sessionTimeRange && (args.query.timeDimensions?.length ?? 0) === 0) {
    for (const measure of args.query.measures ?? []) {
      const cubeName = cubeNameOf(measure);
      if (cubeName && !cubeHasTimeDimension(meta, cubeName)) {
        return {
          ok: false,
          error: 'time_dim_required',
          detail: {
            measure,
            cubeName,
            sessionTimeRange: sessionTimeRange.phrase ?? sessionTimeRange.value.dateRange,
            hint:
              `Session memory has timeRange='${sessionTimeRange.phrase ?? 'set'}', but ` +
              `${measure} lives on snapshot cube ${cubeName} (no time dim). ` +
              `Ask the user to pick a time-aware measure — do not silently drop the time scope.`,
          },
        };
      }
    }
  }

  // 2. Normalize "last N week/month/quarter/year" strings to rolling tuples
  // so the playground URL carries explicit dates. Cube's parser would
  // otherwise resolve these to calendar-aligned windows that drop the
  // current period — surprising for chat-driven analytics. Day-unit ranges
  // and custom tuples pass through unchanged. `effectiveQuery`/`deeplink` are
  // rebuilt below if a coverage snap rewrites an empty relative range.
  let effectiveQuery: z.infer<typeof CubeQuerySchema> = {
    ...args.query,
    timeDimensions: normalizeCubeDateRanges(args.query.timeDimensions),
  };

  // 3. Build deeplink from the normalized query so the URL ?query=… carries
  // the explicit tuple instead of the ambiguous relative string.
  let deeplink = buildChatDeeplink(effectiveQuery);

  // Disclosure appended to the card summary when coverage changed the picture.
  let coverageSuffix = '';

  // 4. Build the embedded chart. The LLM's chart is preferred (it picks a
  // better-typed visual); when it omits one OR its spec fails to build, the
  // server derives a chart deterministically from the query shape + result rows
  // so an artifact ALWAYS carries a chart. All failures here are non-fatal —
  // better to ship the card without a chart than stall the agent loop.
  let chart: QueryArtifact['chart'] = undefined;
  if (args.chart) {
    try {
      chart = buildChartArtifact(args.chart, { artifactRef: deeplink.artifactId });
    } catch (err) {
      console.warn(
        '[emit_query_artifact] LLM chart build failed; falling back to derived chart',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Fallback: only when no LLM chart was attached (absence or build failure).
  // Keeps the extra /load off the common path where the LLM already supplied a
  // valid chart. The covered loader snaps an empty relative range to the latest
  // window with data so the card carries a real chart; when it does, rebuild the
  // deeplink + query from the snapped range so card, chart, and "open in /build"
  // all agree, and disclose the shift. Never throws.
  if (!chart) {
    try {
      const loaded = await loadCubeRowsCovered(args.query, ctx, { maxRows: MAX_ROWS });
      if (loaded.snap?.applied && loaded.snap.snappedRange) {
        effectiveQuery = loaded.query;
        deeplink = buildChatDeeplink(effectiveQuery);
        const [from, to] = loaded.snap.snappedRange;
        coverageSuffix = ` (Showing ${from}–${to}; the requested range had no data — data through ${loaded.snap.latestDate}.)`;
      } else if (loaded.snap && !loaded.snap.applied && loaded.snap.latestDate) {
        coverageSuffix = ` (No data in the requested range; latest available is ${loaded.snap.latestDate}.)`;
      }
      const derived = deriveChartSpec(effectiveQuery, loaded.rows, meta);
      if (derived) {
        chart = buildChartArtifact(derived, { artifactRef: deeplink.artifactId });
        console.info('[emit_query_artifact] attached deterministic fallback chart', derived.type);
      }
    } catch (err) {
      console.warn(
        '[emit_query_artifact] fallback chart failed; emitting artifact without chart',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Resolve a deterministic descriptor for every column in the chart rows so the
  // UI labels axes/headers from /meta (not LLM-invented names) and the
  // column-picker knows which columns are numeric. Applies to both the
  // LLM-supplied and derived charts. Keys are Cube member refs.
  if (chart) {
    const columnKeys = Object.keys(chart.spec.data[0] ?? {});
    chart.columns = columnKeys.map((key) => ({ key, ...resolveMemberMeta(meta, key) }));
  }

  // 5. Build the artifact object — id MUST equal the uuid embedded in the
  // deeplink URL so the FE can resolve sessionStorage-backed payloads by
  // reading the URL param. The artifact carries the normalized query so the
  // card and the deeplink describe the same window.
  const artifact: QueryArtifact = {
    id: deeplink.artifactId,
    title: args.title,
    summary: args.summary + coverageSuffix,
    game: ctx.gameId,
    query: effectiveQuery,
    source: args.source,
    sourceRef: args.sourceRef,
    deeplinkUrl: deeplink.url,
    deeplinkVia: deeplink.via,
    payload: deeplink.payload,
    chart,
  };

  // 6. Emit SSE side-effect — the turn handler listens and writes the event
  ctx.sseEmitter.emit('query_artifact', artifact);

  // 7. Persist the executed query as the session's additive-merge target —
  // a follow-up "add in X" extends THIS query (incl. any agent tweaks the
  // disambiguator never saw). No-op without a db handle (unit tests).
  if (ctx.db) {
    const partial: DisambigResolutions = {
      lastQuery: { value: JSON.stringify(effectiveQuery), phrase: args.title },
    };
    // Continuity write-back (P2, flag-gated): the free-form agent path resolves
    // a metric/window by emitting an artifact, but only the deterministic
    // engine wrote those structured slots — so the next turn re-asked. Persist
    // the unambiguous ones (single measure, an explicit time window) here so
    // the "Resolved so far" injection reflects what the agent just answered.
    // Entity grain inference is deferred to the engine-routing phase. The
    // read-side rephrase gate guards against stale reuse.
    if (config.agentResolvedContextEnabled) {
      Object.assign(partial, deriveResolvedSlots(effectiveQuery));
    }
    mergeResolution(ctx.db, ctx.sessionId, ctx.ownerId, partial);
  }

  return { ok: true, id: artifact.id, deeplinkUrl: deeplink.url };
}

/**
 * Derive the structured slots a continuity injection cares about from an
 * executed query, conservatively: a metric only when the query has exactly one
 * measure (unambiguous), a time window only when an explicit dateRange is set.
 * Returns a partial resolution bag to merge alongside `lastQuery`.
 */
function deriveResolvedSlots(query: {
  measures?: string[];
  timeDimensions?: Array<{ granularity?: string; dateRange?: string | [string, string] }>;
}): DisambigResolutions {
  const partial: DisambigResolutions = {};
  const measures = query.measures ?? [];
  if (measures.length === 1) {
    partial.metric = { value: measures[0] };
  }
  // Persisted without a `phrase`, so the engine's read path treats it as a
  // fixed window (no clock re-resolution) — correct for an explicitly-dated
  // query the agent already resolved to concrete dates.
  const td = query.timeDimensions?.find((t) => t.dateRange != null);
  if (td?.dateRange != null) {
    const value: TimeRangeValue = { dateRange: td.dateRange };
    if (
      td.granularity === 'day' ||
      td.granularity === 'week' ||
      td.granularity === 'month' ||
      td.granularity === 'quarter' ||
      td.granularity === 'year'
    ) {
      value.granularity = td.granularity;
    }
    partial.timeRange = { value };
  }
  return partial;
}
