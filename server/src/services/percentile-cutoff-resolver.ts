/**
 * Shared two-pass percentile-cutoff resolver.
 *
 * "Top quartile LTV" / "above-median ARPPU" can't be a single scalar filter:
 * the cutoff is a property of a *population*, computed at query time. Trino +
 * Cube expose `approx_percentile`, but Cube REST filters can't subquery — so the
 * Cube path resolves the cutoff first (this module), then filters with a plain
 * `gte`/`lte` scalar. The raw-SQL path can inline the subquery instead.
 *
 * Both the Segments predicate compiler and the Care calibration runner call this
 * one resolver so there is a single percentile path. The numeric work is an
 * injected executor so callers pick their data source (Trino REST today) and the
 * builder stays pure + unit-testable.
 *
 * The cutoff MUST be computed over the reference population (e.g. all cfm_vn
 * payers), never the target cohort, or the percentile is circular — the caller
 * supplies the population explicitly via PopulationRef.
 */

import type { PercentileValue, PopulationRef, IdentityMerge } from '../types/predicate-tree.js';

/** A resolved percentile query ready to run against a data source. */
export interface PercentileQuery {
  /** Fully-qualified table the distribution is drawn from. */
  table: string;
  /** Column the percentile is taken over. */
  column: string;
  /** Percentile in (0,100). */
  p: number;
  /**
   * Optional WHERE clause restricting the reference population (e.g. payers
   * only). MUST be a clause already compiled by predicateToSql (validated
   * identifiers + escaped literals) — never raw end-user text. Callers that hold
   * the structured population filter compile it themselves and pass the result
   * here, keeping this module free of a predicate→SQL dependency (no cycle).
   */
  where?: string;
  /**
   * Collapse a multi-row-per-user table to one row per user before taking the
   * percentile. `columns` is every column the percentile/WHERE references (each
   * projected as `<agg>(col) AS col` so the WHERE still binds). Omit for clean
   * one-row tables.
   */
  merge?: IdentityMerge & { columns: string[] };
}

/** Runs a percentile query and returns the numeric cutoff. */
export type PercentileExecutor = (q: PercentileQuery) => Promise<number>;

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;

function assertIdent(ident: string, what: string): string {
  if (!IDENT_RE.test(ident)) {
    throw new Error(`percentile-cutoff-resolver: invalid ${what} "${ident}"`);
  }
  return ident;
}

/**
 * Build the `SELECT approx_percentile(col, p/100) FROM table [WHERE gate]` SQL.
 * Pure + deterministic — the unit of test for the SQL path. Identifiers are
 * validated (defense-in-depth; the population is operator-controlled, not raw
 * end-user input). `p` is clamped to the open interval (0,100).
 */
export function buildPercentileSql(q: PercentileQuery): string {
  const table = assertIdent(q.table, 'table');
  const column = assertIdent(q.column, 'column');
  if (!Number.isFinite(q.p) || q.p < 0 || q.p > 100) {
    throw new Error(`percentile-cutoff-resolver: p must be in [0,100], got ${q.p}`);
  }
  // `where` (when present) is a pre-compiled predicateToSql clause — its
  // identifiers are validated and literals escaped at that boundary, so it is
  // interpolated as a trusted fragment here (same trust model as the raw-SQL
  // predicate path that produced it). Scopes the cutoff to e.g. payers only.
  const whereClause = q.where ? ` WHERE ${q.where}` : '';
  // For multi-row-per-user marts, collapse to one row per user first so the
  // percentile reflects per-user values (not raw rows). The WHERE applies to the
  // merged grain — its columns are projected by `merge.columns`.
  const from = buildMergedFrom(table, q.merge);
  return `SELECT approx_percentile(${column}, ${q.p / 100}) AS cutoff FROM ${from}${whereClause}`;
}

/**
 * The FROM token for a percentile/count query: the bare table for a clean
 * one-row-per-user source, or `(SELECT split_part(id,'@',1) AS id, max(col) AS
 * col, … FROM t GROUP BY 1) m` when the source must be collapsed per user.
 * `table` must already be a validated identifier (callers pass assertIdent output).
 */
export function buildMergedFrom(table: string, merge?: PercentileQuery['merge']): string {
  if (!merge) return table;
  const idCol = assertIdent(merge.idColumn, 'merge.idColumn');
  if (merge.transform !== 'split_part_at') {
    throw new Error(`percentile-cutoff-resolver: unknown identityMerge transform "${merge.transform}"`);
  }
  const agg = merge.agg === 'sum' ? 'sum' : 'max';
  const idExpr = `split_part(${idCol}, '@', 1)`;
  // De-dup + drop the id col from the value projection; each value column is
  // projected as agg(col) AS col so both the outer percentile and the WHERE bind
  // to the merged value by name.
  const cols = [...new Set(merge.columns)].filter((c) => c !== idCol);
  const projected = cols.map((c) => `${agg}(${assertIdent(c, 'merge.column')}) AS ${assertIdent(c, 'merge.column')}`);
  return `(SELECT ${idExpr} AS ${idCol}, ${projected.join(', ')} FROM ${table} GROUP BY 1) m`;
}

/**
 * Resolve a percentile leaf value to an absolute cutoff via `exec`.
 *
 * `member` is the leaf's column (the percentile is taken over it unless the
 * population overrides `column`). `over.table` is required — the cutoff has no
 * meaning without a population to draw from; callers that only know a Cube
 * logical member must map it to a physical table first.
 */
export async function resolvePercentileCutoff(
  member: string,
  value: PercentileValue,
  exec: PercentileExecutor,
  opts: { where?: string; merge?: PercentileQuery['merge'] } = {},
): Promise<number> {
  const over: PopulationRef = value.over ?? {};
  if (!over.table) {
    throw new Error(
      `percentile-cutoff-resolver: percentile over ${member} needs an explicit population table`,
    );
  }
  const q: PercentileQuery = {
    table: over.table,
    column: over.column ?? member,
    p: value.p,
    ...(opts.where ? { where: opts.where } : {}),
    ...(opts.merge ? { merge: opts.merge } : {}),
  };
  const cutoff = await exec(q);
  if (!Number.isFinite(cutoff)) {
    throw new Error(
      `percentile-cutoff-resolver: non-finite cutoff for P${value.p} of ${q.column}`,
    );
  }
  return cutoff;
}

/**
 * Default executor backed by a Trino connector. Runs the percentile query and
 * reads the single `cutoff` scalar from the first row. Imports are dynamic so
 * the pure builder/resolver above stay free of the Trino client (keeps unit
 * tests dependency-light).
 */
export function createTrinoPercentileExecutor(
  connector: { catalog?: string },
  timeoutMs?: number,
): PercentileExecutor {
  return async (q: PercentileQuery): Promise<number> => {
    const { runQuery } = await import('./trino-rest-client.js');
    const sql = buildPercentileSql(q);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await runQuery(connector as any, connector.catalog ?? '', sql, timeoutMs);
    const raw = res.rows?.[0]?.[0];
    const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
    return n;
  };
}
