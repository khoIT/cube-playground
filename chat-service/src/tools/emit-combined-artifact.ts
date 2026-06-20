/**
 * Tool: emit_combined_artifact
 *
 * The LLM calls this when two metrics share the same date axis + window and are
 * worth reading together (e.g. paying DAU vs revenue per day). The two cubes
 * have no Cube join, so they CANNOT be one /load; this tool loads each query
 * independently, aligns the rows on the shared date VALUE, and emits ONE
 * dual-axis card (bars = primary measure / left axis, line = overlay / right).
 *
 * Correctness never depends on the model judging mergeability: the server runs
 * `canMerge` + a post-load snapped-range divergence check, and on ANY reject it
 * emits the two metrics as two normal cards itself (deterministic fallback) by
 * reusing the emit_query_artifact pipeline. The turn therefore always ends with
 * a renderable artifact for each metric — never zero, never an empty dual-axis.
 */

import { z } from 'zod';
import * as cubeMetaCache from '../core/cube-meta-cache.js';
import { resolveMemberMeta } from '../core/cube-meta-capability.js';
import { buildCombinedChatDeeplink } from '../utils/build-chat-deeplink.js';
import { CubeQuerySchema } from './preview-cube-query.js';
import { canMerge } from './can-merge-queries.js';
import { mergeOnDateValue, resolveRowKey, MERGED_DATE_KEY } from './merge-on-date-value.js';
import { buildChartArtifact, MAX_ROWS, type ChartColumn, type ChartSpec } from '../services/chart-spec.js';
import { loadCubeRowsCovered, type LoadCubeResult } from '../services/load-cube-rows.js';
import * as emitQueryArtifact from './emit-query-artifact.js';
import type { ToolContext, QueryArtifact, CubeQuery } from '../types.js';

export const name = 'emit_combined_artifact';
export const description =
  'Emit ONE combined dual-axis card overlaying two metrics on a shared date ' +
  'axis (bars = primary measure on the left, line = overlay measure on the ' +
  'right). Use ONLY when both metrics share the same time granularity and date ' +
  'range and are more useful read together (e.g. paying DAU vs revenue per ' +
  'day). The two queries must each have exactly one dated time dimension and ' +
  'plot different measures. If they cannot be aligned, the server falls back to ' +
  'two normal cards automatically — so prefer this whenever two metrics belong ' +
  'on one date axis.';

export const inputSchema = {
  title: z.string().min(1).describe('Title for the combined card'),
  summary: z.string().min(1).describe('One-sentence description of the overlaid view'),
  primary: CubeQuerySchema.describe('Left-axis (bars) query — one measure, one dated time dimension'),
  overlay: CubeQuerySchema.describe('Right-axis (line) query — a DIFFERENT measure, same date axis'),
  source: z.enum(['business-metric', 'segment', 'raw']),
};

type CombinedArgs = {
  title: string;
  summary: string;
  primary: z.infer<typeof CubeQuerySchema>;
  overlay: z.infer<typeof CubeQuerySchema>;
  source: 'business-metric' | 'segment' | 'raw';
};

type Result =
  | { ok: true; combined: true; id: string; deeplinkUrl: string }
  | { ok: true; combined: false; reason: string; ids: string[] }
  | { ok: false; error: 'unknown_member'; detail: { which: 'measure' | 'dimension'; value: string } };

export async function handler(args: CombinedArgs, ctx: ToolContext): Promise<Result> {
  const meta = await cubeMetaCache.getMeta(ctx.gameId, ctx.workspace);
  const knownMembers = cubeMetaCache.extractMemberNames(meta);

  // 1. Validate every ref on both queries — same gate emit_query_artifact uses.
  for (const q of [args.primary, args.overlay]) {
    const unknown = firstUnknownMember(q, knownMembers);
    if (unknown) return { ok: false, error: 'unknown_member', detail: unknown };
  }

  // 2. Static mergeability — same grain + window, disjoint measures, one dated
  // time dim each. On reject, emit two normal cards deterministically.
  const merge = canMerge(args.primary, args.overlay);
  if (!merge.ok) return twoCardFallback(args, ctx, merge.reason);

  // 3. Load both independently (the cubes share no join). Each can snap an empty
  // relative range to the latest window with data.
  const [pLoad, oLoad] = await Promise.all([
    loadCubeRowsCovered(args.primary, ctx, { maxRows: MAX_ROWS }),
    loadCubeRowsCovered(args.overlay, ctx, { maxRows: MAX_ROWS }),
  ]);

  // 4. Post-load divergence guard: a relative range can snap two cubes at
  // different freshness to different windows. The pre-load range check can't
  // see that — only the resolved windows can. Diverged → two cards.
  if (effectiveRangeKey(pLoad) !== effectiveRangeKey(oLoad)) {
    return twoCardFallback(args, ctx, 'snapped_range_divergence');
  }

  // 5. Empty either side → no honest overlay; let each card disclose its own
  // coverage via the single path.
  if (pLoad.rows.length === 0 || oLoad.rows.length === 0) {
    return twoCardFallback(args, ctx, 'empty_result');
  }

  // 6. Align on the date value. Measure keys keep their full member ref so
  // columns[] can resolve labels/units from /meta.
  const pMeasure = (args.primary.measures ?? [])[0];
  const oMeasure = (args.overlay.measures ?? [])[0];
  const pTimeDim = soleDatedTimeDim(args.primary);
  const oTimeDim = soleDatedTimeDim(args.overlay);
  const merged = mergeOnDateValue(
    {
      rows: pLoad.rows,
      dateKey: resolveRowKey(pLoad.rows, pTimeDim.dimension, pTimeDim.granularity),
      valueKey: resolveRowKey(pLoad.rows, pMeasure),
    },
    {
      rows: oLoad.rows,
      dateKey: resolveRowKey(oLoad.rows, oTimeDim.dimension, oTimeDim.granularity),
      valueKey: resolveRowKey(oLoad.rows, oMeasure),
    },
  );
  if (merged.length === 0) return twoCardFallback(args, ctx, 'empty_merge');

  const valueKey = resolveRowKey(pLoad.rows, pMeasure);
  const seriesKey = resolveRowKey(oLoad.rows, oMeasure);

  // 7. Build the dual-axis chart from the merged rows.
  const spec: ChartSpec = {
    type: 'dual-axis',
    title: args.title,
    data: merged,
    encoding: { category: MERGED_DATE_KEY, value: valueKey, series: seriesKey },
  };
  // Effective queries carry any snapped window so card + deeplink + chart agree.
  const primaryEffective = stripLoadLimit(pLoad.query);
  const overlayEffective = stripLoadLimit(oLoad.query);
  // Combined deeplink: forced session-storage, payload=primary, &combined=1.
  // The overlay rides a sibling sessionStorage key the FE writes on open.
  const deeplink = buildCombinedChatDeeplink(primaryEffective);
  const chart = buildChartArtifact(spec, { artifactRef: deeplink.artifactId });

  // 8. Column descriptors: the synthetic date column labels from the primary's
  // time dimension; measures resolve from /meta like any other artifact.
  const dateLabel = resolveMemberMeta(meta, pTimeDim.dimension).label;
  const columnKeys = unionKeys(merged);
  chart.columns = columnKeys.map<ChartColumn>((key) =>
    key === MERGED_DATE_KEY
      ? { key, label: dateLabel, dataType: 'time', kind: 'timeDimension' }
      : { key, ...resolveMemberMeta(meta, key) },
  );

  // 9. Coverage disclosure — both sides resolved to the SAME window (guard #4),
  // so one disclosure covers the card.
  let summary = args.summary;
  if (pLoad.snap?.applied && pLoad.snap.snappedRange) {
    const [from, to] = pLoad.snap.snappedRange;
    summary += ` (Showing ${from}–${to}; the requested range had no data — data through ${pLoad.snap.latestDate}.)`;
  }

  // 10. Assemble + emit. `query` stays a runnable single CubeQuery so a consumer
  // that doesn't understand `combined` still runs the primary metric.
  const artifact: QueryArtifact = {
    id: deeplink.artifactId,
    title: args.title,
    summary,
    game: ctx.gameId,
    query: primaryEffective,
    overlay: overlayEffective,
    combined: true,
    source: args.source,
    deeplinkUrl: deeplink.url,
    deeplinkVia: deeplink.via,
    payload: deeplink.payload,
    chart,
  };
  ctx.sseEmitter.emit('query_artifact', artifact);

  return { ok: true, combined: true, id: artifact.id, deeplinkUrl: deeplink.url };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** First measure/dimension/timeDim ref not present in /meta, or null. */
function firstUnknownMember(
  query: CubeQuery,
  known: Set<string>,
): { which: 'measure' | 'dimension'; value: string } | null {
  for (const m of query.measures ?? []) if (!known.has(m)) return { which: 'measure', value: m };
  for (const d of query.dimensions ?? []) if (!known.has(d)) return { which: 'dimension', value: d };
  for (const td of query.timeDimensions ?? [])
    if (!known.has(td.dimension)) return { which: 'dimension', value: td.dimension };
  return null;
}

/** The single dated time dimension (canMerge already proved exactly one). */
function soleDatedTimeDim(query: CubeQuery): { dimension: string; granularity?: string } {
  const td = (query.timeDimensions ?? []).find((t) => t.dateRange !== undefined);
  return { dimension: td?.dimension ?? '', granularity: td?.granularity };
}

/** Resolved date window of a load — the snapped range if snapped, else requested. */
function effectiveRangeKey(load: LoadCubeResult): string {
  if (load.snap?.applied && load.snap.snappedRange) return JSON.stringify(load.snap.snappedRange);
  const td = (load.query.timeDimensions ?? []).find((t) => t.dateRange !== undefined);
  return JSON.stringify(td?.dateRange ?? null);
}

/** Drop the loader's row-cap `limit` so the artifact/deeplink query matches emit_query_artifact. */
function stripLoadLimit(query: CubeQuery): CubeQuery {
  const { limit: _limit, ...rest } = query;
  return rest;
}

/** Union of keys across all merged rows (asymmetric gaps mean row[0] is partial). */
function unionKeys(rows: Array<Record<string, string | number>>): string[] {
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
  // Keep the date column first for a stable, readable column order.
  return [MERGED_DATE_KEY, ...[...keys].filter((k) => k !== MERGED_DATE_KEY)];
}

/**
 * Deterministic fallback: emit the two metrics as two normal cards by reusing
 * the single-emit pipeline (full ref validation, chart derivation, deeplink,
 * persistence). Never depends on the model retrying.
 */
async function twoCardFallback(
  args: CombinedArgs,
  ctx: ToolContext,
  reason: string,
): Promise<Result> {
  const overlayLabel = await measureLabel(ctx, (args.overlay.measures ?? [])[0]);
  const cards = [
    { title: args.title, summary: args.summary, query: args.primary },
    {
      title: overlayLabel,
      summary: `${overlayLabel} over the same period.`,
      query: args.overlay,
    },
  ];
  const ids: string[] = [];
  for (const card of cards) {
    const res = await emitQueryArtifact.handler(
      { title: card.title, summary: card.summary, query: card.query, source: args.source },
      ctx,
    );
    if (res.ok) ids.push(res.id);
  }
  return { ok: true, combined: false, reason, ids };
}

/** Human label for a measure ref from /meta; falls back to the bare ref. */
async function measureLabel(ctx: ToolContext, measure: string | undefined): Promise<string> {
  if (!measure) return 'Metric';
  const meta = await cubeMetaCache.getMeta(ctx.gameId, ctx.workspace).catch(() => null);
  return meta ? resolveMemberMeta(meta, measure).label : measure;
}
