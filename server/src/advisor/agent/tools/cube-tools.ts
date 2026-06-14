/**
 * Cube retrieval tools — the agent's window into live data beyond the curated
 * context pack. cube_query runs an aggregate Cube query (provenanced); cube_meta
 * lists the available cubes/measures/dimensions for the active workspace so the
 * agent knows what it can ask for.
 *
 * Aggregate rows pass through stripPiiColumns (laxer than member redaction —
 * keeps analytical dimensions, drops obvious contact columns). The agent is
 * instructed never to query member-level identity/contact columns.
 */

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { readWithProvenance, type AdvisorQuery } from '../../cube-read.js';
import { getMetaWithCtx } from '../../../services/cube-client.js';
import { stripPiiColumns } from '../agent-redaction-guard.js';
import { ok, fail, provenance, type ToolContext } from './tool-context.js';

/** Cap rows returned to the agent to bound token cost. */
const MAX_ROWS = 50;

export function makeCubeQueryTool(tctx: ToolContext) {
  return tool(
    'cube_query',
    'Run an aggregate analytics query (measures + optional dimensions/filters/' +
      'time range) against the live data warehouse for this workspace. Returns ' +
      'aggregated rows plus an evidence link. Use for counts, rates, and trends — ' +
      'never request member identity or contact columns.',
    {
      measures: z.array(z.string()).optional(),
      dimensions: z.array(z.string()).optional(),
      filters: z.array(z.unknown()).optional(),
      timeDimensions: z
        .array(
          z.object({
            dimension: z.string(),
            granularity: z.string().optional(),
            dateRange: z.unknown().optional(),
          }),
        )
        .optional(),
      order: z.record(z.string(), z.string()).optional(),
      limit: z.number().optional(),
    },
    async (args: AdvisorQuery) => {
      const query: AdvisorQuery = { ...args, limit: Math.min(args.limit ?? MAX_ROWS, MAX_ROWS) };
      try {
        const { rows, provenance: link } = await readWithProvenance(
          query,
          tctx.ctx,
          'advisor agent cube_query',
          tctx.reader,
        );
        const safe = stripPiiColumns(rows).slice(0, MAX_ROWS);
        const provenanceId = provenance(tctx, 'cube_query', safe);
        return ok(`Returned ${safe.length} row(s) from ${link.source}.`, {
          provenanceId,
          rows: safe,
          evidence: link,
        });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

interface MetaShape {
  cubes?: Array<{
    name?: string;
    measures?: Array<{ name?: string }>;
    dimensions?: Array<{ name?: string }>;
  }>;
}

export function makeCubeMetaTool(tctx: ToolContext) {
  return tool(
    'cube_meta',
    'List the cubes (tables), measures, and dimensions available in this ' +
      'workspace, so you know what cube_query can ask for. Returns names only.',
    {},
    async () => {
      try {
        const meta = (await getMetaWithCtx(tctx.ctx)) as MetaShape;
        const cubes = (meta.cubes ?? []).map((c) => ({
          name: c.name,
          measures: (c.measures ?? []).map((m) => m.name).filter(Boolean),
          dimensions: (c.dimensions ?? []).map((d) => d.name).filter(Boolean),
        }));
        return ok(`${cubes.length} cube(s) available in this workspace.`, { cubes });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
