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
import { cubeHasTimeDimension, cubeNameOf } from '../core/cube-meta-capability.js';
import { getResolutions } from '../cache/disambig-memory-adapter.js';
import { buildChatDeeplink } from '../utils/build-chat-deeplink.js';
import { CubeQuerySchema } from './preview-cube-query.js';
import {
  ChartSpecSchema,
  buildChartArtifact,
} from '../services/chart-spec.js';
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
    'Optional inline chart suggesting how to visualise this query. ' +
      'Use this instead of a separate emit_chart call when the chart shows the same data the artifact links to.',
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
  const meta = await cubeMetaCache.getMeta(ctx.gameId, ctx.cubeToken);
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

  // 2. Build deeplink
  const deeplink = buildChatDeeplink(args.query);

  // 3. Build optional embedded chart. Failures here are non-fatal — better to
  // ship the artifact card without a chart than to stall the agent loop.
  let chart: QueryArtifact['chart'] = undefined;
  if (args.chart) {
    try {
      chart = buildChartArtifact(args.chart, { artifactRef: deeplink.artifactId });
    } catch (err) {
      console.warn(
        '[emit_query_artifact] chart build failed; emitting artifact without chart',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // 4. Build the artifact object — id MUST equal the uuid embedded in the
  // deeplink URL so the FE can resolve sessionStorage-backed payloads by
  // reading the URL param.
  const artifact: QueryArtifact = {
    id: deeplink.artifactId,
    title: args.title,
    summary: args.summary,
    game: ctx.gameId,
    query: args.query,
    source: args.source,
    sourceRef: args.sourceRef,
    deeplinkUrl: deeplink.url,
    deeplinkVia: deeplink.via,
    payload: deeplink.payload,
    chart,
  };

  // 5. Emit SSE side-effect — the turn handler listens and writes the event
  ctx.sseEmitter.emit('query_artifact', artifact);

  return { ok: true, id: artifact.id, deeplinkUrl: deeplink.url };
}
