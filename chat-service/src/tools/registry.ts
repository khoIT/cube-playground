/**
 * Tool registry — assembles all registered tools and provides buildSdkTools()
 * which binds a ToolContext into each handler and returns the SDK-shaped array
 * ready to pass into claude-runner.
 */

import type { ToolContext } from '../types.js';
import type { ToolDefinition } from '../core/claude-runner.js';

import * as getCubeMeta from './get-cube-meta.js';
import * as resolveQueryTerms from './resolve-query-terms.js';
import * as listDimensionValues from './list-dimension-values.js';
import * as getTimeCoverage from './get-time-coverage.js';
import * as disambiguateQuery from './disambiguate-query.js';
import * as offerChoices from './offer-choices.js';
import * as previewCubeQuery from './preview-cube-query.js';
import * as emitQueryArtifact from './emit-query-artifact.js';
import * as listBusinessMetrics from './list-business-metrics.js';
import * as getBusinessMetric from './get-business-metric.js';
import * as listSegments from './list-segments.js';
import * as getSegment from './get-segment.js';
import * as explainCubeSql from './explain-cube-sql.js';
import * as emitChart from './emit-chart.js';
import * as updateBusinessMetricTrust from './update-business-metric-trust.js';
import * as parseDateRange from './parse-date-range.js';
import * as getBusinessMetricHistory from './get-business-metric-history.js';
import * as getTopicKnowledge from './get-topic-knowledge.js';
import * as getSegmentableMeasures from './get-segmentable-measures.js';
import * as proposeSegment from './propose-segment.js';
import * as decomposeMetric from './decompose-metric.js';
import * as getMetricBenchmark from './get-metric-benchmark.js';
import * as recommendActions from './recommend-actions.js';
import * as careQueue from './care-queue.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Registry entry shape
// ---------------------------------------------------------------------------

interface RegistryEntry {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>;
}

// Each tool module exports: name, description, inputSchema (Zod shape), handler
const REGISTRY: RegistryEntry[] = [
  {
    name: getCubeMeta.name,
    description: getCubeMeta.description,
    inputSchema: getCubeMeta.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: getCubeMeta.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: resolveQueryTerms.name,
    description: resolveQueryTerms.description,
    inputSchema: resolveQueryTerms.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: resolveQueryTerms.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: listDimensionValues.name,
    description: listDimensionValues.description,
    inputSchema: listDimensionValues.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: listDimensionValues.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: getTimeCoverage.name,
    description: getTimeCoverage.description,
    inputSchema: getTimeCoverage.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: getTimeCoverage.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: disambiguateQuery.name,
    description: disambiguateQuery.description,
    inputSchema: disambiguateQuery.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: disambiguateQuery.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: offerChoices.name,
    description: offerChoices.description,
    inputSchema: offerChoices.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: offerChoices.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: previewCubeQuery.name,
    description: previewCubeQuery.description,
    inputSchema: previewCubeQuery.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: previewCubeQuery.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: emitQueryArtifact.name,
    description: emitQueryArtifact.description,
    inputSchema: emitQueryArtifact.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: emitQueryArtifact.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: listBusinessMetrics.name,
    description: listBusinessMetrics.description,
    inputSchema: listBusinessMetrics.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: listBusinessMetrics.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: getBusinessMetric.name,
    description: getBusinessMetric.description,
    inputSchema: getBusinessMetric.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: getBusinessMetric.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: listSegments.name,
    description: listSegments.description,
    inputSchema: listSegments.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: listSegments.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: getSegment.name,
    description: getSegment.description,
    inputSchema: getSegment.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: getSegment.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: explainCubeSql.name,
    description: explainCubeSql.description,
    inputSchema: explainCubeSql.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: explainCubeSql.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: emitChart.name,
    description: emitChart.description,
    inputSchema: emitChart.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: emitChart.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: updateBusinessMetricTrust.name,
    description: updateBusinessMetricTrust.description,
    inputSchema: updateBusinessMetricTrust.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: updateBusinessMetricTrust.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: getBusinessMetricHistory.name,
    description: getBusinessMetricHistory.description,
    inputSchema: getBusinessMetricHistory.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: getBusinessMetricHistory.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: getTopicKnowledge.name,
    description: getTopicKnowledge.description,
    inputSchema: getTopicKnowledge.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: getTopicKnowledge.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: getSegmentableMeasures.name,
    description: getSegmentableMeasures.description,
    inputSchema: getSegmentableMeasures.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: getSegmentableMeasures.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: proposeSegment.name,
    description: proposeSegment.description,
    inputSchema: proposeSegment.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: proposeSegment.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: decomposeMetric.name,
    description: decomposeMetric.description,
    inputSchema: decomposeMetric.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: decomposeMetric.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: getMetricBenchmark.name,
    description: getMetricBenchmark.description,
    inputSchema: getMetricBenchmark.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: getMetricBenchmark.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: recommendActions.name,
    description: recommendActions.description,
    inputSchema: recommendActions.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: recommendActions.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
  {
    name: careQueue.name,
    description: careQueue.description,
    inputSchema: careQueue.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: careQueue.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  },
];

// Phase 07 — decomposed nl-to-query helpers. Flag-gated; the boot-guard
// validates against the SKILL.md allowed_tools so a skill cannot reference
// a tool that the registry hasn't exposed for this process.
if (config.chatNlqDecomposedToolsEnabled) {
  REGISTRY.push({
    name: parseDateRange.name,
    description: parseDateRange.description,
    inputSchema: parseDateRange.inputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: parseDateRange.handler as (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>,
  });
}

/**
 * Return the SDK tool definitions with the ToolContext bound into each handler.
 * The returned array is passed directly to claude-runner.run().
 */
export function buildSdkTools(ctx: ToolContext): ToolDefinition[] {
  return REGISTRY.map((entry) => ({
    name: entry.name,
    description: entry.description,
    inputSchema: entry.inputSchema,
    handler: (args: Record<string, unknown>) => entry.handler(args, ctx),
  }));
}

/** All registered tool names — used for allowedTools in SDK options. */
export const TOOL_NAMES = REGISTRY.map((t) => t.name);
