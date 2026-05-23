/**
 * Tool registry — assembles all registered tools and provides buildSdkTools()
 * which binds a ToolContext into each handler and returns the SDK-shaped array
 * ready to pass into claude-runner.
 */

import type { ToolContext } from '../types.js';
import type { ToolDefinition } from '../core/claude-runner.js';

import * as getCubeMeta from './get-cube-meta.js';
import * as previewCubeQuery from './preview-cube-query.js';
import * as emitQueryArtifact from './emit-query-artifact.js';

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
];

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
