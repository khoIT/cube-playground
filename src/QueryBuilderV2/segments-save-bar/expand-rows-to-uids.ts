/**
 * Executes the expansion Cube Query that materializes actual user_ids from
 * a set of selected cohort rows. Returns a deduplicated list of uids, capped
 * at UID_HARD_CAP per plan (5,000).
 *
 * Throws if Cube returns no rows for any cohort — callers should surface a
 * friendly toast in that case.
 */

import type { CubeApi } from '@cubejs-client/core';
import {
  buildExpansionQuery,
  UID_HARD_CAP,
} from './build-expansion-query';

interface ExpandOpts {
  cubeApi: CubeApi;
  originalQuery: {
    dimensions?: string[];
    measures?: string[];
    timeDimensions?: import('@cubejs-client/core').TimeDimension[];
    filters?: unknown[];
    segments?: string[];
  };
  selectedRows: Record<string, unknown>[];
  identityField: string;
}

export async function expandRowsToUids(opts: ExpandOpts): Promise<string[]> {
  const query = buildExpansionQuery(
    opts.originalQuery,
    opts.selectedRows,
    opts.identityField,
    UID_HARD_CAP,
  );
  const rs = await opts.cubeApi.load(query);
  const rows = rs.tablePivot() as Record<string, unknown>[];
  const uids = rows
    .map((r) => r[opts.identityField])
    .filter((v): v is string | number => v != null)
    .map((v) => String(v));
  return Array.from(new Set(uids));
}
