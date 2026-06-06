/**
 * Shared coverage-probe helpers for pregenerate scripts (starter questions +
 * topic knowledge). Probes the latest date WITH data per cube time dimension
 * so generation prompts can anchor time ranges to reality instead of "today".
 * Extracted from pregenerate-starter-questions.ts so other scripts can import
 * without triggering that script's main().
 */

import { handler as timeCoverageHandler } from '../tools/get-time-coverage.js';
import type { StarterQuestion } from '../db/starter-questions-store.js';
import type { ToolContext } from '../types.js';

/** Coverage probes are real Cube queries — bound the per-game cost. */
export const MAX_COVERAGE_PROBES = 12;

/** First time dimension per cube, from /meta. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function timeDimensionOf(meta: any, cubeName: string): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cube = (meta?.cubes ?? []).find((c: any) => c.name === cubeName);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const td = (cube?.dimensions ?? []).find((d: any) => d.type === 'time');
  return td?.name ?? null;
}

/**
 * Probe the latest date with data for each cube the given questions
 * reference. `known` short-circuits dims probed in an earlier pass.
 */
export async function probeCoverage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any,
  questions: Array<Pick<StarterQuestion, 'targetCatalogIds'>>,
  ctx: ToolContext,
  known: Record<string, string> = {},
): Promise<Record<string, string>> {
  const cubes = new Set<string>();
  for (const q of questions) {
    for (const ref of q.targetCatalogIds) {
      const cube = ref.includes('.') ? ref.split('.')[0] : null;
      if (cube) cubes.add(cube);
    }
  }
  const coverage: Record<string, string> = { ...known };
  for (const cube of [...cubes].slice(0, MAX_COVERAGE_PROBES)) {
    const timeDim = timeDimensionOf(meta, cube);
    if (!timeDim || coverage[timeDim]) continue;
    try {
      const out = (await timeCoverageHandler({ member: timeDim }, ctx)) as {
        found: boolean;
        latestDate?: string;
      };
      if (out.found && out.latestDate) coverage[timeDim] = out.latestDate;
    } catch (err) {
      console.warn(`  coverage probe failed for ${timeDim}: ${(err as Error).message}`);
    }
  }
  return coverage;
}
